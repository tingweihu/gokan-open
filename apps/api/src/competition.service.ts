import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Prisma,
  type Activity,
  type CompetitionEvent,
  type EventEntry,
  type Registration,
  type ScheduleVersion,
} from "@prisma/client";
import { z } from "zod";
import {
  Database,
  fail,
  lock,
  parse,
  uuid,
  version,
  label,
  reason,
  type RequestContext,
  type Tx,
} from "./core.js";
import { IdentityService } from "./identity.service.js";
import { assertStage } from "./stage.js";
import { hasGenderCompositionRules, parseTeamCompositionRules, validateTeamComposition } from "./team-rules.js";
import { LeagueEligibilityService } from "./league.service.js";
import { LeaderMeetingService } from "./leader-meeting.service.js";

const instant = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const eventCode = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/);
const eventShape = z
  .object({
    code: eventCode.optional(),
    name: label,
    displayOrder: z.number().int().min(0),
    enabled: z.boolean(),
    minTeamSize: z.number().int().min(1).nullable(),
    maxTeamSize: z.number().int().min(1).nullable(),
    maxTeamsPerRegistration: z.number().int().min(1),
    teamCapacity: z.number().int().min(1).nullable().optional().default(null),
    allowClub: z.boolean(),
    allowLeague: z.boolean(),
    genderRule: z.enum(["MALE", "FEMALE"]).nullable(),
    allowedGrades: z.array(z.enum(["GRADE_1", "GRADE_2", "GRADE_3"])).max(3),
    rulesJson: z.unknown().nullable().optional().default(null).transform((value) => value === null ? null : parseTeamCompositionRules(value)),
    windows: z.array(z.object({ ordinal: z.number().int().min(1).max(2), startAt: instant, endAt: instant, venue: z.string().trim().max(120).nullable(), label: z.string().trim().max(120).nullable().optional() }).strict().refine((value) => value.startAt < value.endAt, "結束時間必須晚於開始時間")).max(2).optional(),
  })
  .strict();
export const eventInput = eventShape
  .refine((value) => value.allowClub || value.allowLeague, "至少開放一種報名單位")
  .refine(
    (value) =>
      value.minTeamSize === null ||
      value.maxTeamSize === null ||
      value.maxTeamSize >= value.minTeamSize,
    "隊伍上限不可小於下限",
  );
const eventMutation = eventShape
  .extend({ rowVersion: version, reason })
  .strict()
  .refine((value) => value.allowClub || value.allowLeague, "至少開放一種報名單位")
  .refine((value) => value.minTeamSize === null || value.maxTeamSize === null || value.maxTeamSize >= value.minTeamSize, "隊伍上限不可小於下限");
const windowShape = z
  .object({
    eventId: uuid,
    ordinal: z.number().int().min(1),
    startAt: instant,
    endAt: instant,
    venue: z.string().trim().max(120).nullable(),
    label: z.string().trim().max(120).nullable(),
  })
  .strict();
const windowInput = windowShape.refine((value) => value.startAt < value.endAt, "結束時間必須晚於開始時間");
const windowMutation = windowShape.extend({ rowVersion: version }).strict().refine((value) => value.startAt < value.endAt, "結束時間必須晚於開始時間");
const registrationInput = z.object({ organizationId: uuid }).strict();
const entryInput = z.object({ eventId: uuid, rowVersion: version }).strict();
const teamInput = z.object({ ordinal: z.number().int().min(1), rowVersion: version }).strict();
const memberInput = z.object({ participantId: uuid, rowVersion: version }).strict();
const moveInput = z
  .object({
    participantId: uuid,
    fromTeamId: uuid,
    toTeamId: uuid,
    fromRowVersion: version,
    toRowVersion: version,
  })
  .strict();
const replacementInput = z.object({
  teamId: uuid,
  participantId: uuid,
  replacementParticipantId: uuid,
  rowVersion: version,
}).strict();
const admissionInput = z.object({ rowVersion: version, reason }).strict();
export const COMPETITION_TEMPLATE_2025 = [
  { code: "UNLIMITED_DANCE", name: "無限唱跳", quota: 28, venue: "操場", windows: [[1, "09:00", "11:00"], [2, "08:00", "10:00"]], minTeamSize: 5, maxTeamSize: null, maxTeamsPerRegistration: 1, allowClub: true, allowLeague: true, rulesJson: { minGradeOneRatio: 20 } },
  { code: "RELAY_1600", name: "1600 公尺大隊接力", quota: 18, venue: "操場", windows: [[1, "11:00", "12:00"]], minTeamSize: 16, maxTeamSize: 16, maxTeamsPerRegistration: 1, allowClub: true, allowLeague: true, rulesJson: { exactMaleCount: 8, exactFemaleCount: 8, minGradeOneCount: 8 } },
  { code: "BASKETBALL_DICE", name: "鬥牛十八啦", quota: 20, venue: "籃球場", windows: [[1, "13:00", "15:00"]], minTeamSize: 6, maxTeamSize: 6, maxTeamsPerRegistration: 1, allowClub: true, allowLeague: true, rulesJson: { exactMaleCount: 3, exactFemaleCount: 3, minGradeOneCount: 3 } },
  { code: "DESTINY_BOTTLE", name: "命運兌換瓶", quota: 20, venue: "排球場", windows: [[1, "13:00", "15:00"]], minTeamSize: 8, maxTeamSize: 8, maxTeamsPerRegistration: 1, allowClub: true, allowLeague: true, rulesJson: { minGradeOneCount: 4 } },
  { code: "ULTIMATE_FRISBEE", name: "達陣飛盤", quota: 20, venue: "操場", windows: [[1, "13:00", "15:00"]], minTeamSize: 7, maxTeamSize: 7, maxTeamsPerRegistration: 1, allowClub: true, allowLeague: true, rulesJson: { minFemaleCount: 3, minGradeOneCount: 3 } },
  { code: "VARIATION_HANDBALL", name: "變奏手球", quota: 20, venue: "籃球場", windows: [[1, "15:00", "17:00"]], minTeamSize: 6, maxTeamSize: 6, maxTeamsPerRegistration: 1, allowClub: true, allowLeague: true, rulesJson: { minFemaleCount: 3, minGradeOneCount: 3 } },
  { code: "JUMP_ROPE_ARENA", name: "跳繩擂台", quota: 24, venue: "排球場", windows: [[1, "15:00", "17:00"]], minTeamSize: 7, maxTeamSize: 7, maxTeamsPerRegistration: 2, allowClub: true, allowLeague: true, rulesJson: { minGradeOneCount: 3 } },
  { code: "MISSILE_CATCH", name: "飛彈轟轟轟", quota: 30, venue: "操場", windows: [[1, "15:00", "17:00"]], minTeamSize: 6, maxTeamSize: 6, maxTeamsPerRegistration: 2, allowClub: true, allowLeague: true, rulesJson: { minGradeOneCount: 3 } },
  { code: "KIN_BALL", name: "健球", quota: 27, venue: "籃球場", windows: [[2, "10:00", "12:00"]], minTeamSize: 4, maxTeamSize: 4, maxTeamsPerRegistration: 2, allowClub: true, allowLeague: true, rulesJson: { minFemaleCount: 2, minGradeOneCount: 2 } },
  { code: "NINE_GRID_VOLLEYBALL", name: "九宮格排球", quota: 16, venue: "排球場", windows: [[2, "10:00", "12:00"]], minTeamSize: 6, maxTeamSize: 6, maxTeamsPerRegistration: 1, allowClub: true, allowLeague: true, rulesJson: { minFemaleCount: 3, minGradeOneCount: 3 } },
  { code: "SIX_LEGGED_RACE", name: "齊步就跑", quota: 28, venue: "操場", windows: [[2, "10:00", "12:00"]], minTeamSize: 6, maxTeamSize: 6, maxTeamsPerRegistration: 1, allowClub: true, allowLeague: true, rulesJson: { minGradeOneCount: 3 } },
  { code: "CHESS_DODGEBALL", name: "決戰躲避球", quota: 22, venue: "籃球場", windows: [[2, "13:00", "15:00"]], minTeamSize: 10, maxTeamSize: 10, maxTeamsPerRegistration: 1, allowClub: true, allowLeague: true, rulesJson: { minFemaleCount: 4, minGradeOneCount: 4 } },
  { code: "ECO_BOMBARDMENT", name: "環保大轟炸", quota: 26, venue: "排球場", windows: [[2, "13:00", "15:00"]], minTeamSize: 7, maxTeamSize: 7, maxTeamsPerRegistration: 1, allowClub: true, allowLeague: true, rulesJson: { minGradeOneCount: 3 } },
  { code: "ODD_TASK_FORCE", name: "奇異特攻隊", quota: 28, venue: "操場", windows: [[2, "13:00", "15:00"]], minTeamSize: 6, maxTeamSize: 6, maxTeamsPerRegistration: 2, allowClub: true, allowLeague: true, rulesJson: { minGradeOneCount: 3 } },
] as const;

type Assignment = {
  participantId: string;
  eventId: string;
  eventName: string;
  registrationId: string;
  teamMemberId: string;
};
export type ScheduleConflict = {
  participantId: string;
  requestedEventId: string;
  requestedEventName: string;
  requestedStart: Date;
  requestedEnd: Date;
  conflictingEventId: string;
  conflictingEventName: string;
  conflictingStart: Date;
  conflictingEnd: Date;
};

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

function taipeiCalendarDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function taipeiDateTime(competitionStartsAt: Date, day: number, clock: string) {
  const [hours = 0, minutes = 0] = clock.split(":").map(Number);
  const base = taipeiCalendarDate(competitionStartsAt);
  return new Date(Date.UTC(base.year, base.month - 1, base.day + day - 1, hours - 8, minutes));
}

function generatedEventCode() {
  return `MANUAL_${randomUUID().replaceAll("-", "").toUpperCase()}`;
}

@Injectable()
export class CompetitionService {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityService,
    private readonly leagueEligibility: LeagueEligibilityService,
    private readonly leaderMeeting: LeaderMeetingService,
  ) {}

  private async assertStageForMeeting(tx: Tx, activity: Activity, registration: (Pick<Registration, "status" | "confirmedAt"> & { eventEntries?: { id: string }[] }) | null, action: Parameters<typeof assertStage>[2]) {
    const meeting = await this.leaderMeeting.meetingStatus(tx, activity.id);
    assertStage(activity, registration, action, new Date(), meeting?.status);
  }

  async authenticate(request: RequestContext) {
    return this.identity.authenticate(request);
  }

  async admin(request: RequestContext, activityId: string) {
    parse(uuid, activityId);
    const actor = await this.authenticate(request);
    await this.identity.staff(this.db, actor.user.id, activityId, ["SYSTEM_ADMIN"]);
    return actor.user.id;
  }

  async canViewActivity(request: RequestContext, activityId: string) {
    parse(uuid, activityId);
    const actor = await this.authenticate(request);
    const staff = await this.db.activityStaff.findFirst({
      where: {
        userId: actor.user.id,
        activityId,
        revokedAt: null,
        role: { in: ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"] },
      },
    });
    const member = await this.db.organizationMembership.findFirst({
      where: { userId: actor.user.id, revokedAt: null, organization: { activityId, active: true } },
    });
    if (!staff && !member) fail("FORBIDDEN", "您沒有此活動的權限", 403);
    return actor.user.id;
  }

  async registrationScope(tx: Tx, actorId: string, registration: Registration, allowStaff = true, ownerOnly = false) {
    const staff = await tx.activityStaff.findFirst({ where: { userId: actorId, activityId: registration.activityId, revokedAt: null, role: { in: ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"] } } });
    if (staff && allowStaff) return;
    if (registration.organizationId) {
      await this.identity.club(tx, actorId, registration.organizationId);
      return;
    }
    const member = await tx.leagueMember.findFirst({
      where: {
        leagueId: registration.leagueId ?? "",
        status: "CONFIRMED",
        ...(ownerOnly ? { organizationId: { equals: (await tx.league.findUnique({ where: { id: registration.leagueId ?? "" }, select: { ownerOrganizationId: true } }))?.ownerOrganizationId ?? "00000000-0000-0000-0000-000000000000" } } : {}),
        organization: { memberships: { some: { userId: actorId, revokedAt: null } } },
      },
    });
    if (!member) fail("FORBIDDEN", "您沒有此報名單位的操作權限", 403);
  }

  async entryScope(tx: Tx, actorId: string, entryId: string, allowStaff = true, ownerOnly = false) {
    const entry = await tx.eventEntry.findUnique({
      where: { id: entryId },
      include: { registration: true, event: true },
    });
    if (!entry) fail("NOT_FOUND", "找不到賽事報名", 404);
    await this.registrationScope(tx, actorId, entry.registration, allowStaff, ownerOnly);
    return entry;
  }

  async eventEntryScope(tx: Tx, actorId: string, teamId: string, allowStaff = true, ownerOnly = false) {
    const team = await tx.team.findUnique({
      where: { id: teamId },
      include: { eventEntry: { include: { registration: true, event: true } } },
    });
    if (!team) fail("NOT_FOUND", "找不到隊伍", 404);
    await this.registrationScope(tx, actorId, team.eventEntry.registration, allowStaff, ownerOnly);
    return team;
  }

  async activityEvents(request: RequestContext, activityId: string) {
    const actorId = await this.canViewActivity(request, activityId);
    const staff = await this.db.activityStaff.findFirst({ where: { userId: actorId, activityId, revokedAt: null, role: { in: ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"] } } });
    if (staff) return this.db.competitionEvent.findMany({ where: { activityId }, orderBy: [{ displayOrder: "asc" }, { code: "asc" }] });
    const published = await this.db.scheduleVersion.findFirst({ where: { activityId, status: "PUBLISHED" }, orderBy: { version: "desc" }, select: { id: true } });
    if (!published) return [];
    return this.db.competitionEvent.findMany({
      // Published schedule V1 remains authoritative until a newer draft is
      // published. An event removed from Draft V2 is still selectable from
      // V1 while its published window remains present.
      where: { activityId, timeWindows: { some: { scheduleVersionId: published.id } } },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    });
  }

  async eventTemplatePreview(request: RequestContext, activityId: string) {
    await this.admin(request, activityId);
    const existing = await this.db.competitionEvent.findMany({ where: { activityId }, select: { code: true, name: true } });
    const conflicts = existing.map((event) => event.code);
    return { template: "2025", count: COMPETITION_TEMPLATE_2025.length, events: COMPETITION_TEMPLATE_2025, conflicts, canApply: conflicts.length === 0 };
  }

  async eventTemplate(request: RequestContext, activityId: string) {
    await this.admin(request, activityId);
    return { template: "2025", events: COMPETITION_TEMPLATE_2025 };
  }

  private async assertEventBuilderOpen(tx: Tx, activityId: string) {
    const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { id: true, registrationOpensAt: true } });
    if (!activity) fail("NOT_FOUND", "找不到活動", 404);
    if (activity.registrationOpensAt && new Date() >= activity.registrationOpensAt) fail("REGISTRATION_LOCKED", "報名已開始，賽事項目設定已鎖定。", 409);
    const dependency = await tx.registration.count({
      where: {
        activityId,
        OR: [
          { status: { not: "DRAFT" } },
          { eventEntries: { some: {} } },
          { eventClaims: { some: {} } },
          { payments: { some: {} } },
          { refunds: { some: {} } },
        ],
      },
    });
    if (dependency > 0) fail("REGISTRATION_LOCKED", "已有報名資料，賽事項目設定已鎖定。", 409);
  }

  async builderState(request: RequestContext, activityId: string) {
    await this.admin(request, activityId);
    const activity = await this.db.activity.findUnique({ where: { id: activityId }, select: { registrationOpensAt: true } });
    if (!activity) fail("NOT_FOUND", "找不到活動", 404);
    const meaningfulDependency = (await this.db.registration.count({ where: { activityId, OR: [{ status: { not: "DRAFT" } }, { eventEntries: { some: {} } }, { eventClaims: { some: {} } }, { payments: { some: {} } }, { refunds: { some: {} } }] } })) > 0;
    return { locked: Boolean(activity.registrationOpensAt && new Date() >= activity.registrationOpensAt) || meaningfulDependency, registrationStarted: Boolean(activity.registrationOpensAt && new Date() >= activity.registrationOpensAt), meaningfulDependency };
  }

  async applyEventTemplate(request: RequestContext, activityId: string, input: unknown) {
    const actor = await this.admin(request, activityId);
    const confirmation = parse(z.object({ template: z.literal("2025"), confirm: z.literal(true) }).strict(), input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      await this.assertEventBuilderOpen(tx, activityId);
      const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { id: true, competitionStartsAt: true, competitionEndsAt: true } });
      if (!activity) fail("NOT_FOUND", "找不到活動", 404);
      if (!activity.competitionStartsAt || !activity.competitionEndsAt)
        fail("VALIDATION_FAILED", "請先完成年度設定中的正式比賽日期，再帶入 2025 比賽資訊。", 422);
      const existing = await tx.competitionEvent.findMany({ where: { activityId }, select: { code: true } });
      if (existing.length) fail("DUPLICATE_RECORD", "已有賽事項目，為避免重複無法直接帶入 2025 資料。", 409, { existing: existing.map((event) => event.code) });
      const created = [];
      for (const [displayOrder, event] of COMPETITION_TEMPLATE_2025.entries()) {
        created.push(await tx.competitionEvent.create({
          data: {
            activityId,
            code: event.code,
            name: event.name,
            displayOrder: displayOrder + 1,
            enabled: true,
            minTeamSize: event.minTeamSize,
            maxTeamSize: event.maxTeamSize,
            maxTeamsPerRegistration: event.maxTeamsPerRegistration,
            teamCapacity: event.quota,
            allowClub: event.allowClub,
            allowLeague: event.allowLeague,
            genderRule: null,
            allowedGrades: [],
            rulesJson: event.rulesJson,
          },
        }));
      }
      if (activity.competitionStartsAt && activity.competitionEndsAt) {
        const latest = await tx.scheduleVersion.aggregate({ where: { activityId }, _max: { version: true } });
        const schedule = await tx.scheduleVersion.create({ data: { activityId, version: (latest._max.version ?? 0) + 1, createdById: actor } });
        for (const [index, event] of COMPETITION_TEMPLATE_2025.entries()) {
          for (const [ordinal, [day, start, end]] of event.windows.entries()) {
            await tx.eventTimeWindow.create({ data: { activityId, scheduleVersionId: schedule.id, eventId: created[index]!.id, ordinal: ordinal + 1, startAt: taipeiDateTime(activity.competitionStartsAt, day, start), endAt: taipeiDateTime(activity.competitionStartsAt, day, end), venue: event.venue, label: `Day ${day}` } });
          }
        }
      }
      
      return { template: confirmation.template, count: created.length, events: created };
    });
  }

  async createEvent(request: RequestContext, activityId: string, input: unknown) {
    const actor = await this.admin(request, activityId);
    const { windows, ...data } = parse(eventInput, input);
    const code = data.code ?? generatedEventCode();
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      await this.assertEventBuilderOpen(tx, activityId);
      const event = await tx.competitionEvent.create({
        data: { ...data, code, activityId, rulesJson: data.rulesJson === null ? Prisma.JsonNull : data.rulesJson },
      });
      if (windows) await this.syncEventWindows(tx, activityId, actor, event.id, windows);
      
      return event;
    });
  }

  async eventAdmissions(request: RequestContext, activityId: string) {
    const actor = await this.admin(request, activityId);
    const [events, confirmedRegistrations] = await Promise.all([this.db.competitionEvent.findMany({
      where: { activityId },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      include: {
        eventEntries: {
          where: { active: true },
          include: {
            registration: { include: { organization: true, league: true } },
            teams: { orderBy: { ordinal: "asc" }, include: { members: { where: { active: true }, select: { id: true } } } },
          },
        },
      },
    }), this.db.registration.findMany({
      where: { activityId, status: "CONFIRMED" },
      include: { organization: true, league: true },
      orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    })]);
    void actor;
    return events.map((event) => {
      const teams = event.eventEntries.flatMap((entry) => entry.teams.map((team) => ({
        id: team.id,
        ordinal: team.ordinal,
        admissionStatus: team.admissionStatus,
        rowVersion: team.rowVersion,
        registrationId: entry.registrationId,
        unit: entry.registration.organization?.name ?? entry.registration.league?.name ?? "聯隊",
        rosterSize: team.members.length,
      })));
      const admittedCount = teams.filter((team) => team.admissionStatus === "ADMITTED").length;
      const pendingCount = teams.filter((team) => team.admissionStatus === "PENDING").length;
      const activeRegistrationIds = new Set(event.eventEntries.filter((entry) => entry.active).map((entry) => entry.registrationId));
      const availableRegistrations = confirmedRegistrations
        .filter((registration) => !activeRegistrationIds.has(registration.id) && (registration.organizationId ? event.allowClub : event.allowLeague))
        .map((registration) => ({ id: registration.id, rowVersion: registration.rowVersion, unit: registration.organization?.name ?? registration.league?.name ?? "報名單位" }));
      return { id: event.id, name: event.name, teamCapacity: event.teamCapacity, admittedCount, pendingCount, remainingCapacity: event.teamCapacity === null ? null : Math.max(0, event.teamCapacity - admittedCount - pendingCount), teams, availableRegistrations };
    });
  }

  async admitTeam(request: RequestContext, teamId: string, input: unknown) {
    parse(uuid, teamId);
    const actor = await this.authenticate(request);
    const data = parse(admissionInput, input);
    return this.db.$transaction(async (tx) => {
      const team = await tx.team.findUnique({ where: { id: teamId }, include: { eventEntry: { include: { event: true, registration: true } } } });
      if (!team) fail("NOT_FOUND", "找不到隊伍", 404);
      await this.identity.staff(tx, actor.user.id, team.eventEntry.activityId, ["SYSTEM_ADMIN"]);
      await lock(tx, `event-admission:${team.eventEntry.eventId}`);
      if (team.rowVersion !== data.rowVersion) fail("STALE_VERSION", "隊伍已被其他人更新，請重新整理");
      if (team.admissionStatus === "ADMITTED") return team;
      if (team.admissionStatus === "REJECTED") fail("TEAM_ADMISSION_RESOLVED", "未錄取隊伍不可直接改為錄取", 409);
      const pendingPriority = await tx.team.count({ where: { eventEntry: { activityId: team.eventEntry.activityId, eventId: team.eventEntry.eventId, active: true }, ordinal: 1, admissionStatus: "PENDING", id: { not: team.id } } });
      if (team.ordinal > 1 && pendingPriority > 0) fail("TEAM_ADMISSION_BLOCKED", "A 隊仍有待處理名額，B 隊需等待 A 隊先處理", 409);
      const admitted = await tx.team.count({ where: { eventEntry: { activityId: team.eventEntry.activityId, eventId: team.eventEntry.eventId, active: true }, admissionStatus: "ADMITTED" } });
      if (team.eventEntry.event.teamCapacity !== null && admitted >= team.eventEntry.event.teamCapacity) fail("EVENT_CAPACITY_EXCEEDED", "賽事錄取名額已滿，無法錄取此隊伍", 409);
      const updated = await tx.team.update({ where: { id: team.id, rowVersion: data.rowVersion }, data: { admissionStatus: "ADMITTED", rowVersion: { increment: 1 } } });
      
      return updated;
    });
  }

  async rejectTeam(request: RequestContext, teamId: string, input: unknown) {
    parse(uuid, teamId);
    const actor = await this.authenticate(request);
    const data = parse(admissionInput, input);
    return this.db.$transaction(async (tx) => {
      const team = await tx.team.findUnique({
        where: { id: teamId },
        include: {
          members: { where: { active: true }, select: { participantId: true } },
          eventEntry: { include: { registration: true } },
        },
      });
      if (!team) fail("NOT_FOUND", "找不到隊伍", 404);
      await this.identity.staff(tx, actor.user.id, team.eventEntry.activityId, ["SYSTEM_ADMIN"]);
      await lock(tx, `event-admission:${team.eventEntry.eventId}`);
      if (team.rowVersion !== data.rowVersion) fail("STALE_VERSION", "隊伍已被其他人更新，請重新整理");
      if (team.admissionStatus === "REJECTED") return team;
      if (team.admissionStatus !== "PENDING") fail("TEAM_ADMISSION_RESOLVED", "已錄取隊伍不可在此改為未錄取", 409);
      const updated = await tx.team.update({
        where: { id: team.id, rowVersion: data.rowVersion },
        data: { admissionStatus: "REJECTED", rowVersion: { increment: 1 } },
      });
      if (team.members.length) {
        await tx.participantEventClaim.deleteMany({
          where: {
            eventEntryId: team.eventEntryId,
            participantId: { in: team.members.map((member) => member.participantId) },
          },
        });
      }
      
      return updated;
    });
  }

  async updateEvent(
    request: RequestContext,
    activityId: string,
    eventId: string,
    input: unknown,
  ) {
    const actor = await this.admin(request, activityId);
    parse(uuid, eventId);
    const { rowVersion, reason: why, windows, ...data } = parse(eventMutation, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      await this.assertEventBuilderOpen(tx, activityId);
      const current = await tx.competitionEvent.findFirst({ where: { id: eventId, activityId } });
      if (!current) fail("NOT_FOUND", "找不到賽事項目", 404);
      const event = await tx.competitionEvent.update({
        where: { id: current.id, rowVersion },
        data: { ...data, code: current.code, rulesJson: data.rulesJson === null ? Prisma.JsonNull : data.rulesJson, rowVersion: { increment: 1 } },
      });
      if (windows) await this.syncEventWindows(tx, activityId, actor, event.id, windows);
      
      return event;
    });
  }

  private async syncEventWindows(tx: Tx, activityId: string, actorId: string, eventId: string, windows: { ordinal: number; startAt: Date; endAt: Date; venue: string | null; label?: string | null }[]) {
    if (!windows.length) {
      const draft = await tx.scheduleVersion.findFirst({ where: { activityId, status: "DRAFT" }, orderBy: { version: "desc" } });
      if (draft) await tx.eventTimeWindow.deleteMany({ where: { activityId, scheduleVersionId: draft.id, eventId } });
      return;
    }
    const ordinals = new Set(windows.map((window) => window.ordinal));
    if (ordinals.size !== windows.length) fail("EVENT_TIME_CONFLICT", "同一賽事項目不可重複設定同一天", 409);
    let draft = await tx.scheduleVersion.findFirst({ where: { activityId, status: "DRAFT" }, orderBy: { version: "desc" } });
    if (!draft) {
      const published = await tx.scheduleVersion.findFirst({ where: { activityId, status: "PUBLISHED" }, orderBy: { version: "desc" }, include: { timeWindows: true } });
      const latest = await tx.scheduleVersion.aggregate({ where: { activityId }, _max: { version: true } });
      draft = await tx.scheduleVersion.create({ data: { activityId, version: (latest._max.version ?? 0) + 1, createdById: actorId } });
      if (published) await tx.eventTimeWindow.createMany({ data: published.timeWindows.map((window) => ({ activityId, scheduleVersionId: draft!.id, eventId: window.eventId, ordinal: window.ordinal, startAt: window.startAt, endAt: window.endAt, venue: window.venue, label: window.label })) });
    }
    await tx.eventTimeWindow.deleteMany({ where: { activityId, scheduleVersionId: draft.id, eventId } });
    await tx.eventTimeWindow.createMany({ data: windows.map((window) => ({ activityId, scheduleVersionId: draft.id, eventId, ordinal: window.ordinal, startAt: window.startAt, endAt: window.endAt, venue: window.venue, label: window.label ?? null })) });
    await tx.scheduleVersion.update({ where: { id: draft.id }, data: { rowVersion: { increment: 1 } } });
  }

  async deleteEvent(request: RequestContext, activityId: string, eventId: string, input: unknown) {
    const actor = await this.admin(request, activityId);
    parse(uuid, eventId);
    const { reason: why } = parse(z.object({ reason }).strict(), input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      await this.assertEventBuilderOpen(tx, activityId);
      const event = await tx.competitionEvent.findFirst({ where: { id: eventId, activityId }, include: { _count: { select: { eventEntries: true, eventClaims: true, feeOverrides: true } } } });
      if (!event) fail("NOT_FOUND", "找不到賽事項目", 404);
      const historicalWindowCount = await tx.eventTimeWindow.count({ where: { activityId, eventId: event.id, scheduleVersion: { status: { not: "DRAFT" } } } });
      if (historicalWindowCount) {
        let draft = await tx.scheduleVersion.findFirst({ where: { activityId, status: "DRAFT" }, orderBy: { version: "desc" } });
        if (!draft) {
          const published = await tx.scheduleVersion.findFirst({ where: { activityId, status: "PUBLISHED" }, orderBy: { version: "desc" }, include: { timeWindows: true } });
          if (published) {
            const latest = await tx.scheduleVersion.aggregate({ where: { activityId }, _max: { version: true } });
            draft = await tx.scheduleVersion.create({ data: { activityId, version: (latest._max.version ?? 0) + 1, createdById: actor } });
            await tx.eventTimeWindow.createMany({ data: published.timeWindows.map((window) => ({ activityId, scheduleVersionId: draft!.id, eventId: window.eventId, ordinal: window.ordinal, startAt: window.startAt, endAt: window.endAt, venue: window.venue, label: window.label })) });
          }
        }
        if (draft) await tx.eventTimeWindow.deleteMany({ where: { activityId, scheduleVersionId: draft.id, eventId: event.id } });
        const disabled = await tx.competitionEvent.update({ where: { id: event.id, rowVersion: event.rowVersion }, data: { enabled: false, rowVersion: { increment: 1 } } });
        
        return { id: disabled.id, deleted: false, disabled: true };
      }
      if (event._count.eventEntries || event._count.eventClaims || event._count.feeOverrides) fail("DEPENDENCY_EXISTS", "賽事項目已有報名或財務資料，請停用而不要刪除", 409);
      await tx.eventTimeWindow.deleteMany({ where: { activityId, eventId: event.id, scheduleVersion: { status: "DRAFT" } } });
      await tx.competitionEvent.delete({ where: { id: event.id } });
      
      return { id: event.id, deleted: true };
    });
  }

  private async draft(tx: Tx, actorId: string, scheduleId: string) {
    const schedule = await tx.scheduleVersion.findUnique({ where: { id: scheduleId } });
    if (!schedule) fail("NOT_FOUND", "找不到時程草稿", 404);
    await this.identity.staff(tx, actorId, schedule.activityId, ["SYSTEM_ADMIN"]);
    if (schedule.status !== "DRAFT") fail("SCHEDULE_PUBLISHED_LOCKED", "已發布時程不可直接修改");
    await this.assertEventBuilderOpen(tx, schedule.activityId);
    return schedule;
  }

  async schedules(request: RequestContext, activityId: string) {
    const actorId = await this.canViewActivity(request, activityId);
    const staff = await this.db.activityStaff.findFirst({ where: { userId: actorId, activityId, revokedAt: null, role: { in: ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"] } } });
    return this.db.scheduleVersion.findMany({
      where: { activityId, ...(staff ? {} : { status: "PUBLISHED" }) },
      include: { timeWindows: { include: { event: true }, orderBy: [{ startAt: "asc" }, { ordinal: "asc" }] } },
      orderBy: { version: "desc" },
    });
  }

  async createSchedule(request: RequestContext, activityId: string) {
    const actor = await this.admin(request, activityId);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      await this.assertEventBuilderOpen(tx, activityId);
      const latest = await tx.scheduleVersion.aggregate({ where: { activityId }, _max: { version: true } });
      const schedule = await tx.scheduleVersion.create({
        data: { activityId, version: (latest._max.version ?? 0) + 1, createdById: actor },
      });
      
      return schedule;
    });
  }

  async windows(request: RequestContext, scheduleId: string) {
    parse(uuid, scheduleId);
    const actor = await this.authenticate(request);
    const schedule = await this.db.scheduleVersion.findUnique({ where: { id: scheduleId } });
    if (!schedule) fail("NOT_FOUND", "找不到時程草稿", 404);
    const activityStaff = await this.db.activityStaff.findFirst({ where: { userId: actor.user.id, activityId: schedule.activityId, revokedAt: null, role: { in: ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"] } } });
    const member = await this.db.organizationMembership.findFirst({ where: { userId: actor.user.id, revokedAt: null, organization: { activityId: schedule.activityId, active: true } } });
    if (!activityStaff && !member) fail("FORBIDDEN", "您沒有此時程的權限", 403);
    if (!activityStaff && schedule.status !== "PUBLISHED") fail("NOT_FOUND", "找不到正式時程", 404);
    return this.db.eventTimeWindow.findMany({ where: { scheduleVersionId: scheduleId }, include: { event: true }, orderBy: [{ startAt: "asc" }, { ordinal: "asc" }] });
  }

  async createWindow(request: RequestContext, scheduleId: string, input: unknown) {
    parse(uuid, scheduleId);
    const actor = await this.authenticate(request);
    const data = parse(windowInput, input);
    return this.db.$transaction(async (tx) => {
      const schedule = await this.draft(tx, actor.user.id, scheduleId);
      const event = await tx.competitionEvent.findFirst({ where: { id: data.eventId, activityId: schedule.activityId } });
      if (!event) fail("NOT_FOUND", "找不到同年度賽事項目", 404);
      const window = await tx.eventTimeWindow.create({ data: { ...data, activityId: schedule.activityId, scheduleVersionId: scheduleId } });
      await tx.scheduleVersion.update({ where: { id: scheduleId, rowVersion: schedule.rowVersion }, data: { rowVersion: { increment: 1 } } });
      
      return window;
    });
  }

  async updateWindow(request: RequestContext, scheduleId: string, windowId: string, input: unknown) {
    parse(uuid, scheduleId); parse(uuid, windowId);
    const actor = await this.authenticate(request);
    const { rowVersion, ...data } = parse(windowMutation, input);
    return this.db.$transaction(async (tx) => {
      const schedule = await this.draft(tx, actor.user.id, scheduleId);
      if (schedule.rowVersion !== rowVersion) fail("STALE_VERSION", "時程資料已被其他人更新，請重新整理");
      const window = await tx.eventTimeWindow.findFirst({ where: { id: windowId, scheduleVersionId: scheduleId } });
      if (!window) fail("NOT_FOUND", "找不到時程區段", 404);
      const event = await tx.competitionEvent.findFirst({ where: { id: data.eventId, activityId: schedule.activityId } });
      if (!event) fail("NOT_FOUND", "找不到同年度賽事項目", 404);
      const result = await tx.eventTimeWindow.update({ where: { id: windowId }, data: { ...data } });
      await tx.scheduleVersion.update({ where: { id: scheduleId, rowVersion }, data: { rowVersion: { increment: 1 } } });
      
      return result;
    });
  }

  async deleteWindow(request: RequestContext, scheduleId: string, windowId: string, rowVersionValue: unknown) {
    parse(uuid, scheduleId); parse(uuid, windowId);
    const actor = await this.authenticate(request);
    const rowVersion = parse(version, rowVersionValue);
    return this.db.$transaction(async (tx) => {
      const schedule = await this.draft(tx, actor.user.id, scheduleId);
      if (schedule.rowVersion !== rowVersion) fail("STALE_VERSION", "時程資料已被其他人更新，請重新整理");
      const window = await tx.eventTimeWindow.findFirst({ where: { id: windowId, scheduleVersionId: scheduleId } });
      if (!window) fail("NOT_FOUND", "找不到時程區段", 404);
      await tx.eventTimeWindow.delete({ where: { id: windowId } });
      await tx.scheduleVersion.update({ where: { id: scheduleId, rowVersion }, data: { rowVersion: { increment: 1 } } });
      
      return { success: true };
    });
  }

  private async assignments(tx: Tx, activityId: string, participantId?: string): Promise<Assignment[]> {
    const members = await tx.teamMember.findMany({
      where: {
        activityId,
        active: true,
        team: { admissionStatus: { not: "REJECTED" } },
        eventEntry: { active: true },
        ...(participantId ? { participantId } : {}),
      },
      include: { eventEntry: { include: { event: true } } },
    });
    return members.map((member) => ({ participantId: member.participantId, eventId: member.eventEntry.eventId, eventName: member.eventEntry.event.name, registrationId: member.eventEntry.registrationId, teamMemberId: member.id }));
  }

  async analyzeSchedule(tx: Tx, schedule: ScheduleVersion): Promise<ScheduleConflict[]> {
    const windows = await tx.eventTimeWindow.findMany({ where: { scheduleVersionId: schedule.id }, include: { event: true }, orderBy: { startAt: "asc" } });
    const active = await this.assignments(tx, schedule.activityId);
    const byParticipant = new Map<string, Assignment[]>();
    for (const assignment of active) byParticipant.set(assignment.participantId, [...(byParticipant.get(assignment.participantId) ?? []), assignment]);
    const conflicts: ScheduleConflict[] = [];
    for (const [participantId, assignments] of byParticipant) {
      for (let i = 0; i < assignments.length; i++) {
        for (let j = i + 1; j < assignments.length; j++) {
          const left = assignments[i]!; const right = assignments[j]!;
          if (left.eventId === right.eventId) continue;
          const leftWindows = windows.filter((window) => window.eventId === left.eventId);
          const rightWindows = windows.filter((window) => window.eventId === right.eventId);
          for (const a of leftWindows) for (const b of rightWindows) if (overlaps(a.startAt, a.endAt, b.startAt, b.endAt)) conflicts.push({ participantId, requestedEventId: right.eventId, requestedEventName: right.eventName, requestedStart: b.startAt, requestedEnd: b.endAt, conflictingEventId: left.eventId, conflictingEventName: left.eventName, conflictingStart: a.startAt, conflictingEnd: a.endAt });
        }
      }
    }
    for (let i = 0; i < windows.length; i++) {
      const left = windows[i]!;
      for (let j = i + 1; j < windows.length; j++) {
        const right = windows[j]!;
        if (left.eventId === right.eventId) continue;
        if ((left.venue ?? "") !== (right.venue ?? "") || !overlaps(left.startAt, left.endAt, right.startAt, right.endAt)) continue;
        conflicts.push({
          participantId: "",
          requestedEventId: right.eventId,
          requestedEventName: right.event.name,
          requestedStart: right.startAt,
          requestedEnd: right.endAt,
          conflictingEventId: left.eventId,
          conflictingEventName: left.event.name,
          conflictingStart: left.startAt,
          conflictingEnd: left.endAt,
        });
      }
    }
    return conflicts;
  }

  async impact(request: RequestContext, scheduleId: string) {
    parse(uuid, scheduleId);
    const actor = await this.authenticate(request);
    const schedule = await this.db.scheduleVersion.findUnique({ where: { id: scheduleId } });
    if (!schedule) fail("NOT_FOUND", "找不到時程", 404);
    await this.identity.staff(this.db, actor.user.id, schedule.activityId, ["SYSTEM_ADMIN"]);
    const conflicts = await this.db.$transaction((tx) => this.analyzeSchedule(tx, schedule));
    return { scheduleId, conflictCount: conflicts.length, conflicts };
  }

  async publish(request: RequestContext, scheduleId: string) {
    parse(uuid, scheduleId);
    const actor = await this.authenticate(request);
    return this.db.$transaction(async (tx) => {
      const schedule = await tx.scheduleVersion.findUnique({ where: { id: scheduleId } });
      if (!schedule) fail("NOT_FOUND", "找不到時程草稿", 404);
      await this.identity.staff(tx, actor.user.id, schedule.activityId, ["SYSTEM_ADMIN"]);
      await lock(tx, `activity:${schedule.activityId}`);
      await this.assertEventBuilderOpen(tx, schedule.activityId);
      const current = await tx.scheduleVersion.findUniqueOrThrow({ where: { id: scheduleId } });
      if (current.status !== "DRAFT") fail("SCHEDULE_PUBLISH_BLOCKED", "只有草稿可以發布");
      const conflicts = await this.analyzeSchedule(tx, current);
      if (conflicts.length) fail("SCHEDULE_PUBLISH_BLOCKED", "時程仍有選手時間衝突，無法發布", 409, { conflictCount: conflicts.length, conflicts });
      await tx.scheduleVersion.updateMany({ where: { activityId: current.activityId, status: "PUBLISHED" }, data: { status: "ARCHIVED" } });
      const published = await tx.scheduleVersion.update({ where: { id: current.id, rowVersion: current.rowVersion }, data: { status: "PUBLISHED", publishedById: actor.user.id, publishedAt: new Date(), rowVersion: { increment: 1 } } });
      
      return published;
    });
  }

  async getOrCreateRegistration(request: RequestContext, activityId: string, input: unknown) {
    const actor = await this.authenticate(request);
    const data = parse(registrationInput, input);
    const club = await this.identity.club(this.db, actor.user.id, data.organizationId);
    if (club.activityId !== activityId) fail("FORBIDDEN", "您沒有此活動的社團權限", 403);
    const activity = await this.db.activity.findUnique({ where: { id: activityId } });
    if (!activity) fail("NOT_FOUND", "找不到活動", 404);
    await this.assertStageForMeeting(this.db, activity, null, "team");
    await this.registrationReadiness(this.db, activityId);
    return this.db.registration.upsert({ where: { activityId_organizationId: { activityId, organizationId: data.organizationId } }, create: { activityId, organizationId: data.organizationId }, update: {} });
  }

  private async registrationReadiness(db: Database | Tx, activityId: string) {
    const [feeSchedule, published] = await Promise.all([
      db.feeSchedule.findUnique({ where: { activityId }, select: { id: true } }),
      db.scheduleVersion.findFirst({ where: { activityId, status: "PUBLISHED", timeWindows: { some: {} } }, select: { id: true } }),
    ]);
    if (!feeSchedule || !published)
      fail("REGISTRATION_NOT_READY", "本年度報名設定尚未完成，請聯絡主辦單位。", 422, { feeScheduleConfigured: Boolean(feeSchedule), competitionPublished: Boolean(published) });
  }

  private ensureRegistrationEditable(registration: Registration) {
    if (!["DRAFT", "RETURNED"].includes(registration.status))
      fail("REGISTRATION_LOCKED", "報名送出審核後不可修改", 409);
  }

  async registrations(request: RequestContext, activityId: string) {
    const actorId = await this.canViewActivity(request, activityId);
    const staff = await this.db.activityStaff.findFirst({ where: { userId: actorId, activityId, revokedAt: null, role: { in: ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"] } } });
    const memberships = await this.db.organizationMembership.findMany({ where: { userId: actorId, revokedAt: null, organization: { activityId } }, select: { organizationId: true } });
    const organizationIds = memberships.map((m) => m.organizationId);
    const rows = await this.db.registration.findMany({
      where: staff ? { activityId } : {
        activityId,
        OR: [
          { organizationId: { in: organizationIds } },
          { league: { members: { some: { organizationId: { in: organizationIds }, status: "CONFIRMED" } } } },
        ],
      },
      include: { organization: true, league: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((registration) => ({
      ...registration,
      writable: Boolean(staff?.role === "SYSTEM_ADMIN" || (registration.organizationId && organizationIds.includes(registration.organizationId)) || (registration.leagueId && registration.league && organizationIds.includes(registration.league.ownerOrganizationId))),
    }));
  }

  async getOrCreateLeagueRegistration(request: RequestContext, activityId: string, leagueId: string) {
    parse(uuid, activityId); parse(uuid, leagueId);
    const actor = await this.authenticate(request);
    const league = await this.db.league.findUnique({ where: { id: leagueId } });
    if (!league || league.activityId !== activityId) fail("NOT_FOUND", "找不到聯隊", 404);
    const member = await this.db.leagueMember.findFirst({ where: { leagueId, status: "CONFIRMED", organizationId: league.ownerOrganizationId, organization: { memberships: { some: { userId: actor.user.id, revokedAt: null } } } } });
    const staff = await this.db.activityStaff.findFirst({ where: { userId: actor.user.id, activityId, revokedAt: null, role: "SYSTEM_ADMIN" } });
    if (!member && !staff) fail("FORBIDDEN", "您沒有此聯隊的操作權限", 403);
    const activity = await this.db.activity.findUnique({ where: { id: activityId } });
    if (!activity) fail("NOT_FOUND", "找不到活動", 404);
    await this.assertStageForMeeting(this.db, activity, null, "team");
    await this.registrationReadiness(this.db, activityId);
    const eligibility = await this.leagueEligibility.evaluate(this.db, leagueId);
    if (!eligibility.eligible) fail("LEAGUE_NOT_ELIGIBLE", "此聯隊目前尚未符合報名資格，請先完成聯隊資格條件。", 422, eligibility);
    return this.db.registration.upsert({ where: { activityId_leagueId: { activityId, leagueId } }, create: { activityId, leagueId }, update: {} });
  }

  async registration(request: RequestContext, registrationId: string) {
    parse(uuid, registrationId);
    const actor = await this.authenticate(request);
    const result = await this.db.registration.findUnique({ where: { id: registrationId }, include: { organization: true, league: true, eventEntries: { include: { event: true, teams: { include: { members: { include: { participant: true } } } } } } } });
    if (!result) fail("NOT_FOUND", "找不到報名", 404);
    await this.registrationScope(this.db, actor.user.id, result);
    return result;
  }

  async createEntry(request: RequestContext, registrationId: string, input: unknown) {
    parse(uuid, registrationId);
    const actor = await this.authenticate(request);
    const data = parse(entryInput, input);
    return this.db.$transaction(async (tx) => {
      const registration = await tx.registration.findUnique({ where: { id: registrationId } });
      if (!registration) fail("NOT_FOUND", "找不到報名", 404);
      await this.registrationScope(tx, actor.user.id, registration, false, Boolean(registration.leagueId));
      const activity = await tx.activity.findUniqueOrThrow({ where: { id: registration.activityId } });
      if (registration.status === "CONFIRMED") await this.assertStageForMeeting(tx, activity, registration, "addEvent");
      else { await this.assertStageForMeeting(tx, activity, registration, "addEvent"); this.ensureRegistrationEditable(registration); }
      if (registration.rowVersion !== data.rowVersion) fail("STALE_VERSION", "報名資料已更新，請重新整理");
      const published = await tx.scheduleVersion.findFirst({ where: { activityId: registration.activityId, status: "PUBLISHED", timeWindows: { some: { eventId: data.eventId } } }, select: { id: true } });
      // The current published schedule, rather than the mutable builder flag,
      // defines Leader-visible event authority until a replacement is published.
      const event = await tx.competitionEvent.findFirst({ where: { id: data.eventId, activityId: registration.activityId } });
      if (!published || !event) fail("VALIDATION_FAILED", "目前賽事項目尚未正式發布，無法加入報名。", 422);
      if (registration.organizationId && !event.allowClub) fail("VALIDATION_FAILED", "此賽事項目不接受社團報名", 422);
      if (registration.leagueId && !event.allowLeague) fail("VALIDATION_FAILED", "此賽事項目不接受聯隊報名", 422);
      const memberOrganizationIds = registration.leagueId
        ? (await tx.leagueMember.findMany({ where: { leagueId: registration.leagueId, status: "CONFIRMED" }, select: { organizationId: true } })).map((item) => item.organizationId)
        : [];
      const competingRegistration = registration.leagueId
        ? await tx.eventEntry.findFirst({ where: { activityId: registration.activityId, eventId: data.eventId, active: true, registration: { organizationId: { in: memberOrganizationIds } } } })
        : registration.organizationId
          ? await tx.eventEntry.findFirst({ where: { activityId: registration.activityId, eventId: data.eventId, active: true, registration: { league: { members: { some: { organizationId: registration.organizationId, status: "CONFIRMED" } } } } } })
          : null;
      if (competingRegistration) fail("DUPLICATE_RECORD", "同一社團不可同時以社團與聯隊報名此賽事項目", 409);
      const existingEntry = await tx.eventEntry.findUnique({ where: { registrationId_eventId: { registrationId, eventId: data.eventId } } });
      if (existingEntry?.active) fail("DUPLICATE_RECORD", "此賽事項目已加入報名", 409);
      const entry = existingEntry
        ? await tx.eventEntry.update({ where: { id: existingEntry.id }, data: { active: true, source: registration.status === "CONFIRMED" ? "LEADER_MEETING" : "REGISTRATION", rowVersion: { increment: 1 } } })
        : await tx.eventEntry.create({ data: { activityId: registration.activityId, registrationId, eventId: data.eventId, source: registration.status === "CONFIRMED" ? "LEADER_MEETING" : "REGISTRATION" } });
      await tx.registration.update({ where: { id: registrationId, rowVersion: data.rowVersion }, data: { rowVersion: { increment: 1 } } });
      
      return entry;
    });
  }

  async removeEntry(request: RequestContext, registrationId: string, eventId: string, rowVersionValue: unknown) {
    parse(uuid, registrationId); parse(uuid, eventId);
    const actor = await this.authenticate(request);
    const rowVersion = parse(version, rowVersionValue);
    return this.db.$transaction(async (tx) => {
      const registration = await tx.registration.findUnique({ where: { id: registrationId } });
      if (!registration) fail("NOT_FOUND", "找不到報名", 404);
      await this.registrationScope(tx, actor.user.id, registration, false, Boolean(registration.leagueId));
      const activity = await tx.activity.findUniqueOrThrow({ where: { id: registration.activityId } });
      if (registration.status === "CONFIRMED") await this.assertStageForMeeting(tx, activity, registration, "removeEvent");
      else { await this.assertStageForMeeting(tx, activity, registration, "removeEvent"); this.ensureRegistrationEditable(registration); }
      if (registration.rowVersion !== rowVersion) fail("STALE_VERSION", "報名資料已更新，請重新整理");
      const entry = await tx.eventEntry.findUnique({ where: { registrationId_eventId: { registrationId, eventId } }, include: { teams: { include: { members: { where: { active: true } } } } } });
      if (!entry || !entry.active) return { success: true };
      if (entry.teams.some((team) => team.members.length > 0)) fail("REGISTRATION_LOCKED", "已有選手配置的賽事項目不能直接取消，請先調整隊伍");
      await tx.participantEventClaim.deleteMany({ where: { eventEntryId: entry.id } });
      await tx.eventEntry.update({ where: { id: entry.id }, data: { active: false, rowVersion: { increment: 1 } } });
      await tx.registration.update({ where: { id: registrationId, rowVersion }, data: { rowVersion: { increment: 1 } } });
      
      return { success: true };
    });
  }

  async createTeam(request: RequestContext, entryId: string, input: unknown) {
    parse(uuid, entryId);
    const actor = await this.authenticate(request);
    const data = parse(teamInput, input);
    return this.db.$transaction(async (tx) => {
      const entry = await this.entryScope(tx, actor.user.id, entryId, false, true);
      const activity = await tx.activity.findUniqueOrThrow({ where: { id: entry.registration.activityId } });
      if (entry.registration.status === "CONFIRMED") await this.assertStageForMeeting(tx, activity, entry.registration, "createTeam");
      else { await this.assertStageForMeeting(tx, activity, entry.registration, "createTeam"); this.ensureRegistrationEditable(entry.registration); }
      if (entry.rowVersion !== data.rowVersion) fail("STALE_VERSION", "賽事報名已更新，請重新整理");
      await lock(tx, `event-admission:${entry.eventId}`);
      const count = await tx.team.count({ where: { eventEntryId: entryId } });
      if (count >= entry.event.maxTeamsPerRegistration) fail("TEAM_SIZE_INVALID", "已達此賽事的隊伍數量上限");
      if (data.ordinal > entry.event.maxTeamsPerRegistration) fail("TEAM_SIZE_INVALID", "隊伍序號超過賽事上限");
      if (data.ordinal > 1) {
        const primary = await tx.team.findFirst({ where: { eventEntryId: entryId, ordinal: 1 }, include: { members: { where: { active: true } } } });
        if (!primary) fail("TEAM_SIZE_INVALID", "請先建立並完成 A 隊，再建立 B 隊", 409);
        await this.checkTeamRules(tx, entry, primary.id, primary.members.map((member) => member.participantId), true);
        const allowedOrganizations = entry.registration.organizationId
          ? [entry.registration.organizationId]
          : (await tx.leagueMember.findMany({ where: { leagueId: entry.registration.leagueId ?? "", status: "CONFIRMED" }, select: { organizationId: true } })).map((member) => member.organizationId);
        const available = await tx.participant.count({ where: { activityId: entry.activityId, active: true, sourceOrganizationId: { in: allowedOrganizations }, id: { notIn: primary.members.map((member) => member.participantId) }, ...(!hasGenderCompositionRules(entry.event.rulesJson) && entry.event.genderRule ? { gender: entry.event.genderRule } : {}), ...(entry.event.allowedGrades.length ? { grade: { in: entry.event.allowedGrades } } : {}) } });
        if (entry.event.minTeamSize !== null && available < entry.event.minTeamSize) fail("TEAM_SIZE_INVALID", `目前另有 ${available} 名可用選手，至少需要 ${entry.event.minTeamSize} 人，暫時無法建立第二隊`, 409);
      }
      const admitted = await tx.team.count({ where: { eventEntry: { activityId: entry.activityId, eventId: entry.eventId, active: true }, admissionStatus: "ADMITTED" } });
      const admissionStatus = entry.event.teamCapacity === null || (data.ordinal === 1 && admitted < entry.event.teamCapacity) ? "ADMITTED" : "PENDING";
      const team = await tx.team.create({ data: { eventEntryId: entryId, ordinal: data.ordinal, admissionStatus } });
      await tx.eventEntry.update({ where: { id: entryId, rowVersion: data.rowVersion }, data: { rowVersion: { increment: 1 } } });
      
      return team;
    });
  }

  async createPrimaryTeamForOptimizer(
    tx: Prisma.TransactionClient,
    actorId: string,
    entryId: string,
    expectedRowVersion: number,
  ) {
    const entry = await this.entryScope(tx, actorId, entryId, false, true);
    const activity = await tx.activity.findUniqueOrThrow({ where: { id: entry.registration.activityId } });
    await this.assertStageForMeeting(tx, activity, entry.registration, "createTeam");
    this.ensureRegistrationEditable(entry.registration);
    if (entry.rowVersion !== expectedRowVersion) fail("STALE_VERSION", "賽事報名已更新，請重新整理");
    await lock(tx, `event-admission:${entry.eventId}`);
    const existing = await tx.team.findFirst({ where: { eventEntryId: entryId, ordinal: 1 } });
    if (existing) fail("STALE_VERSION", "A 隊已由其他操作建立，請重新產生建議");
    const count = await tx.team.count({ where: { eventEntryId: entryId } });
    if (count >= entry.event.maxTeamsPerRegistration) fail("TEAM_SIZE_INVALID", "已達此賽事的隊伍數量上限");
    const admitted = await tx.team.count({
      where: {
        eventEntry: { activityId: entry.activityId, eventId: entry.eventId, active: true },
        admissionStatus: "ADMITTED",
      },
    });
    const admissionStatus = entry.event.teamCapacity === null || admitted < entry.event.teamCapacity ? "ADMITTED" : "PENDING";
    const team = await tx.team.create({ data: { eventEntryId: entryId, ordinal: 1, admissionStatus } });
    await tx.eventEntry.update({
      where: { id: entryId, rowVersion: expectedRowVersion },
      data: { rowVersion: { increment: 1 } },
    });
    
    return team;
  }

  private async participantAllowed(tx: Tx, registration: Registration, participantId: string) {
    const participant = await tx.participant.findUnique({ where: { id: participantId } });
    if (!participant || participant.activityId !== registration.activityId || !participant.active) fail("PARTICIPANT_NOT_ELIGIBLE", "找不到有效的同年度選手", 422);
    if (registration.organizationId && participant.sourceOrganizationId !== registration.organizationId) fail("PARTICIPANT_NOT_ELIGIBLE", "選手不屬於此社團", 422);
    if (registration.leagueId) {
      const confirmed = await tx.leagueMember.findFirst({ where: { leagueId: registration.leagueId, organizationId: participant.sourceOrganizationId, status: "CONFIRMED" } });
      if (!confirmed) fail("PARTICIPANT_NOT_ELIGIBLE", "選手所屬社團尚未確認加入此聯隊", 422);
    }
    return participant;
  }

  async participantForAssignment(tx: Tx, registration: Registration, participantId: string) {
    return this.participantAllowed(tx, registration, participantId);
  }

  async checkTimeConflict(tx: Tx, entry: EventEntry & { event: CompetitionEvent }, participantId: string) {
    const published = await tx.scheduleVersion.findFirst({ where: { activityId: entry.activityId, status: "PUBLISHED" }, include: { timeWindows: { include: { event: true } } } });
    if (!published) return;
    const requested = published.timeWindows.filter((window) => window.eventId === entry.eventId);
    const existing = await this.assignments(tx, entry.activityId, participantId);
    const conflicts: ScheduleConflict[] = [];
    for (const assignment of existing) {
      if (assignment.eventId === entry.eventId) continue;
      for (const left of requested) for (const right of published.timeWindows.filter((window) => window.eventId === assignment.eventId)) if (overlaps(left.startAt, left.endAt, right.startAt, right.endAt)) conflicts.push({ participantId, requestedEventId: entry.eventId, requestedEventName: entry.event.name, requestedStart: left.startAt, requestedEnd: left.endAt, conflictingEventId: assignment.eventId, conflictingEventName: assignment.eventName, conflictingStart: right.startAt, conflictingEnd: right.endAt });
    }
    if (conflicts.length) fail("EVENT_TIME_CONFLICT", "選手參賽時間衝突", 409, { conflicts });
  }

  private async checkTeamRules(tx: Tx, entry: EventEntry & { event: CompetitionEvent }, teamId: string, participantIds: string[], enforceMinimum = true) {
    const team = await tx.team.findUnique({ where: { id: teamId } });
    if (!team || team.eventEntryId !== entry.id) fail("NOT_FOUND", "找不到同一賽事的隊伍", 404);
    if (!enforceMinimum && entry.event.minTeamSize !== null && participantIds.length < entry.event.minTeamSize) return;
    if (entry.event.minTeamSize !== null && participantIds.length < entry.event.minTeamSize)
      fail("TEAM_SIZE_INVALID", `隊伍至少需要 ${entry.event.minTeamSize} 位選手`, 422);
    if (entry.event.maxTeamSize !== null && participantIds.length > entry.event.maxTeamSize)
      fail("TEAM_SIZE_INVALID", `隊伍最多只能有 ${entry.event.maxTeamSize} 位選手`, 422);
    const participants = await tx.participant.findMany({ where: { id: { in: participantIds } }, select: { gender: true, grade: true } });
    const result = validateTeamComposition(entry.event, participants);
    if (!result.valid && (enforceMinimum || participantIds.length >= (entry.event.minTeamSize ?? 0) || participantIds.length > (entry.event.maxTeamSize ?? Number.MAX_SAFE_INTEGER)))
      fail("TEAM_COMPOSITION_INVALID", result.blockers[0] ?? "隊伍規則尚未符合", 422, result);
  }

  async addMember(request: RequestContext, teamId: string, input: unknown) {
    parse(uuid, teamId);
    const actor = await this.authenticate(request);
    const data = parse(memberInput, input);
    return this.db.$transaction(async (tx) => {
      const team = await this.eventEntryScope(tx, actor.user.id, teamId, false, true);
      const entry = team.eventEntry;
      if (team.admissionStatus === "REJECTED") fail("TEAM_NOT_ACTIVE", "未錄取隊伍不可再調整選手", 409);
      const activity = await tx.activity.findUniqueOrThrow({ where: { id: entry.registration.activityId } });
      if (entry.registration.status === "CONFIRMED") await this.assertStageForMeeting(tx, activity, entry.registration, "replacement");
      else { await this.assertStageForMeeting(tx, activity, entry.registration, "replacement"); this.ensureRegistrationEditable(entry.registration); }
      if (team.rowVersion !== data.rowVersion) fail("STALE_VERSION", "隊伍已被其他人更新，請重新整理");
      const participant = await this.participantAllowed(tx, entry.registration, data.participantId);
      if (!hasGenderCompositionRules(entry.event.rulesJson) && entry.event.genderRule && participant.gender !== entry.event.genderRule) fail("PARTICIPANT_NOT_ELIGIBLE", "選手性別不符合賽事規則", 422);
      if (entry.event.allowedGrades.length && !entry.event.allowedGrades.includes(participant.grade)) fail("PARTICIPANT_NOT_ELIGIBLE", "選手年級不符合賽事規則", 422);
      const teamMembers = await tx.teamMember.findMany({ where: { teamId, active: true } });
      await this.checkTeamRules(tx, entry, teamId, [...teamMembers.map((member) => member.participantId), data.participantId], false);
      if (await tx.teamMember.findFirst({ where: { eventEntryId: entry.id, participantId: data.participantId, active: true } })) fail("TEAM_MEMBER_DUPLICATE", "選手已在此賽事的其他隊伍", 409);
      await this.checkTimeConflict(tx, entry, data.participantId);
      let member;
      try {
        const inactive = await tx.teamMember.findFirst({ where: { eventEntryId: entry.id, participantId: data.participantId, active: false } });
        member = inactive
          ? await tx.teamMember.update({ where: { id: inactive.id }, data: { teamId, active: true, removedAt: null, rowVersion: { increment: 1 } } })
          : await tx.teamMember.create({ data: { activityId: entry.activityId, eventEntryId: entry.id, teamId, participantId: data.participantId } });
        await tx.participantEventClaim.create({ data: { activityId: entry.activityId, eventId: entry.eventId, participantId: data.participantId, registrationId: entry.registrationId, eventEntryId: entry.id } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") fail("PARTICIPANT_EVENT_ALREADY_CLAIMED", "選手已被其他報名單位使用此賽事", 409, { participantId: data.participantId, eventId: entry.eventId });
        throw error;
      }
      await tx.team.update({ where: { id: teamId, rowVersion: data.rowVersion }, data: { rowVersion: { increment: 1 } } });
      
      return member;
    });
  }

  async removeMember(request: RequestContext, teamId: string, participantId: string, rowVersionValue: unknown) {
    parse(uuid, teamId); parse(uuid, participantId);
    const actor = await this.authenticate(request); const rowVersion = parse(version, rowVersionValue);
    return this.db.$transaction(async (tx) => {
      const team = await this.eventEntryScope(tx, actor.user.id, teamId, false, true); const entry = team.eventEntry;
      if (team.admissionStatus === "REJECTED") fail("TEAM_NOT_ACTIVE", "未錄取隊伍不可再調整選手", 409);
      const activity = await tx.activity.findUniqueOrThrow({ where: { id: entry.registration.activityId } });
      if (entry.registration.status === "CONFIRMED") await this.assertStageForMeeting(tx, activity, entry.registration, "replacement");
      else { await this.assertStageForMeeting(tx, activity, entry.registration, "replacement"); this.ensureRegistrationEditable(entry.registration); }
      if (team.rowVersion !== rowVersion) fail("STALE_VERSION", "隊伍已被其他人更新，請重新整理");
      const member = await tx.teamMember.findFirst({ where: { teamId, participantId, active: true } }); if (!member) fail("NOT_FOUND", "找不到隊伍選手", 404);
      // Removing a member is an intermediate editing state. Do not block an
      // individual X action on the team's current composition; validation on
      // roster submission still requires the completed team to satisfy every
      // rule, and the leader can then refill or correct the roster.
      await tx.teamMember.update({ where: { id: member.id }, data: { active: false, removedAt: new Date(), rowVersion: { increment: 1 } } });
      await tx.participantEventClaim.deleteMany({ where: { eventEntryId: entry.id, participantId } });
      await tx.team.update({ where: { id: teamId, rowVersion }, data: { rowVersion: { increment: 1 } } });
      return { success: true };
    });
  }

  async moveMember(request: RequestContext, input: unknown) {
    const actor = await this.authenticate(request); const data = parse(moveInput, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `participant:${data.participantId}`);
      const from = await this.eventEntryScope(tx, actor.user.id, data.fromTeamId, false, true); const to = await this.eventEntryScope(tx, actor.user.id, data.toTeamId, false, true);
      if (from.admissionStatus === "REJECTED" || to.admissionStatus === "REJECTED") fail("TEAM_NOT_ACTIVE", "未錄取隊伍不可再調整選手", 409);
      const activity = await tx.activity.findUniqueOrThrow({ where: { id: from.eventEntry.registration.activityId } });
      if (from.eventEntry.registration.status === "CONFIRMED") await this.assertStageForMeeting(tx, activity, from.eventEntry.registration, "team");
      else { await this.assertStageForMeeting(tx, activity, from.eventEntry.registration, "team"); this.ensureRegistrationEditable(from.eventEntry.registration); }
      if (from.eventEntry.id !== to.eventEntry.id) fail("VALIDATION_FAILED", "只能在同一賽事的 A／B 隊之間移動", 422);
      if (from.rowVersion !== data.fromRowVersion || to.rowVersion !== data.toRowVersion) fail("STALE_VERSION", "隊伍已被其他人更新，請重新整理");
      const member = await tx.teamMember.findFirst({ where: { teamId: data.fromTeamId, participantId: data.participantId, active: true } }); if (!member) fail("NOT_FOUND", "找不到來源隊伍選手", 404);
      if (await tx.teamMember.findFirst({ where: { teamId: data.toTeamId, participantId: data.participantId, active: true } })) fail("TEAM_MEMBER_DUPLICATE", "選手已在目的隊伍", 409);
      const [fromMembers, toMembers] = await Promise.all([tx.teamMember.findMany({ where: { teamId: data.fromTeamId, active: true, id: { not: member.id } } }), tx.teamMember.findMany({ where: { teamId: data.toTeamId, active: true } })]);
      await this.checkTeamRules(tx, from.eventEntry, data.fromTeamId, fromMembers.map((item) => item.participantId));
      await this.checkTeamRules(tx, to.eventEntry, data.toTeamId, [...toMembers.map((item) => item.participantId), data.participantId]);
      await tx.teamMember.update({ where: { id: member.id }, data: { teamId: data.toTeamId, rowVersion: { increment: 1 } } });
      await tx.team.update({ where: { id: data.fromTeamId, rowVersion: data.fromRowVersion }, data: { rowVersion: { increment: 1 } } });
      await tx.team.update({ where: { id: data.toTeamId, rowVersion: data.toRowVersion }, data: { rowVersion: { increment: 1 } } });
      
      return { success: true };
    });
  }

  async replaceMember(request: RequestContext, input: unknown) {
    const actor = await this.authenticate(request);
    const data = parse(replacementInput, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `team:${data.teamId}`);
      await lock(tx, `participant:${data.replacementParticipantId}`);
      const team = await this.eventEntryScope(tx, actor.user.id, data.teamId, false, true);
      const entry = team.eventEntry;
      if (team.admissionStatus === "REJECTED") fail("TEAM_NOT_ACTIVE", "未錄取隊伍不可再調整選手", 409);
      const activity = await tx.activity.findUniqueOrThrow({ where: { id: entry.registration.activityId } });
      if (entry.registration.status === "CONFIRMED") await this.assertStageForMeeting(tx, activity, entry.registration, "replacement");
      else { await this.assertStageForMeeting(tx, activity, entry.registration, "replacement"); this.ensureRegistrationEditable(entry.registration); }
      if (team.rowVersion !== data.rowVersion) fail("STALE_VERSION", "隊伍已被其他人更新，請重新整理");
      const current = await tx.teamMember.findFirst({ where: { teamId: data.teamId, participantId: data.participantId, active: true } });
      if (!current) fail("NOT_FOUND", "找不到要替換的隊伍選手", 404);
      const participant = await this.participantAllowed(tx, entry.registration, data.replacementParticipantId);
      if (!hasGenderCompositionRules(entry.event.rulesJson) && entry.event.genderRule && participant.gender !== entry.event.genderRule) fail("PARTICIPANT_NOT_ELIGIBLE", "選手性別不符合賽事規則", 422);
      if (entry.event.allowedGrades.length && !entry.event.allowedGrades.includes(participant.grade)) fail("PARTICIPANT_NOT_ELIGIBLE", "選手年級不符合賽事規則", 422);
      if (await tx.teamMember.findFirst({ where: { eventEntryId: entry.id, participantId: data.replacementParticipantId, active: true } })) fail("TEAM_MEMBER_DUPLICATE", "替補選手已在此賽事", 409);
      await this.checkTimeConflict(tx, entry, data.replacementParticipantId);
      try {
        await tx.participantEventClaim.deleteMany({ where: { eventEntryId: entry.id, participantId: data.participantId } });
        await tx.participantEventClaim.create({ data: { activityId: entry.activityId, eventId: entry.eventId, participantId: data.replacementParticipantId, registrationId: entry.registrationId, eventEntryId: entry.id } });
        const updated = await tx.teamMember.update({ where: { id: current.id, rowVersion: current.rowVersion }, data: { participantId: data.replacementParticipantId, rowVersion: { increment: 1 } } });
        await tx.team.update({ where: { id: data.teamId, rowVersion: data.rowVersion }, data: { rowVersion: { increment: 1 } } });
        
        return updated;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") fail("PARTICIPANT_EVENT_ALREADY_CLAIMED", "替補選手已被其他報名單位使用此賽事", 409, { participantId: data.replacementParticipantId, eventId: entry.eventId });
        throw error;
      }
    });
  }
}
