import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  Database,
  fail,
  lock,
  parse,
  uuid,
  label,
  reason,
  version,
  type RequestContext,
  type Tx,
} from "./core.js";
import { IdentityService } from "./identity.service.js";
import { FinanceCalculationService } from "./finance-calculation.service.js";
import { operatingStage, stageReason } from "./stage.js";
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v));
const settings = z
  .object({
    rowVersion: version,
    name: label,
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
    registrationOpensAt: instant,
    registrationClosesAt: instant,
    paymentDueAt: instant,
    leaderMeetingStartsAt: instant,
    leaderMeetingEndsAt: instant,
    competitionStartsAt: instant,
    competitionEndsAt: instant,
    reason,
  })
  .strict()
  .superRefine((d, ctx) => {
    const issue = (path: keyof typeof d, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (d.registrationOpensAt >= d.registrationClosesAt) issue("registrationClosesAt", "請調整「報名截止」：報名截止必須晚於報名開始。");
    if (d.registrationClosesAt > d.leaderMeetingStartsAt) issue("leaderMeetingStartsAt", "請調整「領隊會議開始」：領隊會議開始不得早於報名截止。");
    if (d.leaderMeetingStartsAt >= d.leaderMeetingEndsAt) issue("leaderMeetingEndsAt", "請調整「領隊會議結束」：結束時間必須晚於開始時間。");
    if (d.leaderMeetingEndsAt > d.competitionStartsAt) issue("competitionStartsAt", "請調整「比賽開始」：比賽開始不得早於領隊會議結束。");
    if (d.competitionStartsAt >= d.competitionEndsAt) issue("competitionEndsAt", "請調整「比賽結束」：比賽結束必須晚於比賽開始。");
    if (d.paymentDueAt < d.registrationOpensAt) issue("paymentDueAt", "請調整「繳費截止」：繳費截止不得早於報名開始。");
    if (d.paymentDueAt < d.registrationClosesAt) issue("paymentDueAt", "請調整「繳費截止」：繳費截止不得早於報名截止。");
    if (d.paymentDueAt > d.competitionEndsAt) issue("paymentDueAt", "請調整「繳費截止」：繳費截止不得晚於比賽結束。");
  });
const clubData = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/),
    name: label,
    shortName: z.string().trim().max(30).nullable(),
    active: z.boolean(),
  })
  .strict();
@Controller("activities")
export class ActivityController {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityService,
    private readonly financeCalculation: FinanceCalculationService,
  ) {}
  private async access(
    request: RequestContext,
    activityId: string,
    admin = false,
  ) {
    parse(uuid, activityId);
    const actor = await this.identity.authenticate(request);
    if (admin)
      await this.identity.staff(this.db, actor.user.id, activityId, [
        "SYSTEM_ADMIN",
      ]);
    else {
      const staff = await this.db.activityStaff.findFirst({
        where: {
          userId: actor.user.id,
          activityId,
          revokedAt: null,
          role: { in: ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"] },
        },
      });
      const member = await this.db.organizationMembership.findFirst({
        where: {
          userId: actor.user.id,
          revokedAt: null,
          organization: { activityId, active: true },
        },
      });
      if (!staff && !member) fail("FORBIDDEN", "您沒有此活動的權限", 403);
    }
    return actor.user.id;
  }
  @Get(":activityId")
  async get(
    @Req() req: RequestContext,
    @Param("activityId") activityId: string,
  ) {
    await this.access(req, activityId);
    const activity = await this.db.activity.findUniqueOrThrow({
      where: { id: activityId },
    });
    return { ...activity, stage: operatingStage(activity), stageReason: stageReason(activity) };
  }
  @Get(":activityId/dashboard-summary")
  async dashboardSummary(
    @Req() req: RequestContext,
    @Param("activityId") activityId: string,
  ) {
    await this.access(req, activityId, true);
    const [clubs, registrations, participants, leagueAssignments] = await Promise.all([
      this.db.organization.findMany({
        where: { activityId, active: true },
        select: {
          id: true,
          memberships: {
            where: { revokedAt: null, role: { in: ["LEADER", "DEPUTY"] } },
            select: { user: { select: { lastLoginAt: true } } },
          },
        },
      }),
      this.db.registration.findMany({
        where: { activityId, organizationId: { not: null }, organization: { active: true } },
        select: {
          id: true,
          status: true,
        },
      }),
      this.db.participant.findMany({
        where: { activityId, active: true, sourceOrganization: { active: true } },
        select: { gender: true, grade: true },
      }),
      this.db.teamMember.findMany({
        where: {
          activityId,
          active: true,
          participant: { active: true, activityId },
          eventEntry: { active: true, registration: { activityId, leagueId: { not: null } } },
        },
        select: { participantId: true },
        distinct: ["participantId"],
      }),
    ]);
    const loggedIn = clubs.filter((club) => club.memberships.some((membership) => membership.user.lastLoginAt !== null)).length;
    const registering = registrations.filter((r) => ["DRAFT", "RETURNED", "SUBMITTED"].includes(r.status)).length;
    const financeState = await Promise.all(registrations.map(async (registration) => {
      const finance = await this.financeCalculation.calculate(this.db, registration.id);
      return {
        status: registration.status,
        amountDue: finance.amountDue,
        netPaid: finance.netPaid,
        complete: registration.status === "CONFIRMED" && finance.financiallyEligible,
      };
    }));
    const paying = financeState.filter((state) => state.status === "CONFIRMED" && !state.complete).length;
    const completed = financeState.filter((state) => state.complete).length;
    const leagueParticipantIds = new Set(leagueAssignments.map((assignment) => assignment.participantId));
    const expectedRevenue = financeState.reduce((sum, state) => sum + state.amountDue, 0);
    const paidRevenue = financeState.reduce((sum, state) => sum + Math.max(0, state.netPaid), 0);
    return {
      clubs: { total: clubs.length, loggedIn, registering, paying, completed },
      participants: {
        total: participants.length,
        male: participants.filter((p) => p.gender === "MALE").length,
        female: participants.filter((p) => p.gender === "FEMALE").length,
        grade1: participants.filter((p) => p.grade === "GRADE_1").length,
        grade2: participants.filter((p) => p.grade === "GRADE_2").length,
        grade3: participants.filter((p) => p.grade === "GRADE_3").length,
        assignedThroughLeague: leagueParticipantIds.size,
        notAssignedThroughLeague: Math.max(0, participants.length - leagueParticipantIds.size),
      },
      finance: { expectedRevenue, paidRevenue, outstandingRevenue: Math.max(0, expectedRevenue - paidRevenue) },
      reviews: {
        pending: registrations.filter((r) => r.status === "SUBMITTED").length,
        returned: registrations.filter((r) => r.status === "RETURNED").length,
        confirmed: registrations.filter((r) => r.status === "CONFIRMED").length,
      },
    };
  }
  @Post()
  async create(@Req() req: RequestContext, @Body() input: unknown) {
    const data = parse(
      z
        .object({
          authorizedActivityId: uuid,
          year: z.number().int().min(2020).max(2200),
          name: label,
          reason,
        })
        .strict(),
      input,
    );
    const actor = await this.access(req, data.authorizedActivityId, true);
    return this.db.$transaction(async (tx) => {
      await lock(tx, "gokan:activities");
      await this.identity.staff(tx, actor, data.authorizedActivityId, [
        "SYSTEM_ADMIN",
      ]);
      const activity = await tx.activity.create({
        data: { year: data.year, code: `GOKAN-${data.year}`, name: data.name },
      });
      await tx.activityStaff.create({
        data: { userId: actor, activityId: activity.id, role: "SYSTEM_ADMIN" },
      });
      
      return activity;
    });
  }
  @Patch(":activityId")
  async update(
    @Req() req: RequestContext,
    @Param("activityId") activityId: string,
    @Body() input: unknown,
  ) {
    const actor = await this.access(req, activityId, true);
    const { rowVersion, reason: why, ...data } = parse(settings, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, "gokan:activities");
      await lock(tx, `activity:${activityId}`);
      await this.identity.staff(tx, actor, activityId, ["SYSTEM_ADMIN"]);
      if (
        data.status === "ACTIVE" &&
        (await tx.activity.count({
          where: { id: { not: activityId }, status: "ACTIVE" },
        }))
      )
        fail("ACTIVITY_ALREADY_ACTIVE", "請先封存目前年度活動");
      const before = await tx.activity.findUniqueOrThrow({
        where: { id: activityId },
      });
      if (before.registrationOpensAt && new Date() >= before.registrationOpensAt) {
        const structuralChanged = ([
          "name",
          "registrationOpensAt",
          "registrationClosesAt",
          "paymentDueAt",
          "leaderMeetingStartsAt",
          "leaderMeetingEndsAt",
          "competitionStartsAt",
          "competitionEndsAt",
        ] as const).some((key) => {
          const previous = before[key];
          const next = data[key];
          if (previous instanceof Date && next instanceof Date)
            return previous.getTime() !== next.getTime();
          return previous !== next;
        });
        if (structuralChanged)
          fail("ACTIVITY_STAGE_FORBIDS_ACTION", "報名已開始，年度日期設定已鎖定。", 409);
      }
      const activity = await tx.activity.update({
        where: { id: activityId, rowVersion },
        data: { ...data, rowVersion: { increment: 1 } },
      });
      
      return { ...activity, stage: operatingStage(activity), stageReason: stageReason(activity) };
    });
  }
  @Get(":activityId/clubs")
  async clubs(
    @Req() req: RequestContext,
    @Param("activityId") activityId: string,
  ) {
    await this.access(req, activityId);
    return this.db.organization.findMany({
      where: { activityId },
      orderBy: { code: "asc" },
    });
  }
  async writable(tx: Tx, actor: string, activityId: string) {
    await lock(tx, `activity:${activityId}`);
    await this.identity.staff(tx, actor, activityId, ["SYSTEM_ADMIN"]);
    const activity = await tx.activity.findUniqueOrThrow({
      where: { id: activityId },
    });
    if (activity.status === "ARCHIVED")
      fail("ACTIVITY_STAGE_FORBIDS_ACTION", "活動已封存");
  }
  @Post(":activityId/clubs")
  async createClub(
    @Req() req: RequestContext,
    @Param("activityId") activityId: string,
    @Body() input: unknown,
  ) {
    const actor = await this.access(req, activityId, true);
    const data = parse(clubData, input);
    return this.db.$transaction(async (tx) => {
      await this.writable(tx, actor, activityId);
      const club = await tx.organization.create({
        data: { activityId, ...data },
      });
      
      return club;
    });
  }
  @Patch(":activityId/clubs/:clubId")
  async updateClub(
    @Req() req: RequestContext,
    @Param("activityId") activityId: string,
    @Param("clubId") clubId: string,
    @Body() input: unknown,
  ) {
    const actor = await this.access(req, activityId, true);
    parse(uuid, clubId);
    const {
      rowVersion,
      reason: why,
      ...data
    } = parse(clubData.extend({ rowVersion: version, reason }).strict(), input);
    return this.db.$transaction(async (tx) => {
      await this.writable(tx, actor, activityId);
      const club = await tx.organization.update({
        where: { id: clubId, activityId, rowVersion },
        data: { ...data, rowVersion: { increment: 1 } },
      });
      
      return club;
    });
  }
}
