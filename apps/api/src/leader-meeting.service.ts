import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Database, fail, lock, parse, uuid, reason, type RequestContext, type Tx } from "./core.js";
import { IdentityService } from "./identity.service.js";
import { FinanceCalculationService } from "./finance-calculation.service.js";
import { RegistrationValidationService } from "./registration-validation.service.js";

const transition = z.enum(["start", "close-entry", "close"]);
const transitionInput = z.object({ reason }).strict();
const admissionEntryInput = z.object({ registrationId: uuid, eventId: uuid, reason }).strict();

type DbLike = Database | Tx;
type MeetingAccess = {
  actorId: string;
  staffRole: "SYSTEM_ADMIN" | "REGISTRATION_FINANCE" | "CHECKIN_EXPORT" | null;
  organizationIds: string[];
};
type SnapshotRegistration = {
  registrationId: string;
  unit: { id: string; name: string; kind: "CLUB" | "LEAGUE" };
  status: string;
  finance: { amountDue: number; netPaid: number; balanceDue: number; credit: number; financiallyEligible: boolean };
  eventEntries: Array<{
    eventId: string;
    eventName: string;
    teams: Array<{
      teamId: string;
      ordinal: number;
      admissionStatus: "PENDING" | "ADMITTED" | "REJECTED";
      members: Array<{
        participantId: string;
        name: string;
        gender: string;
        grade: string;
        sourceOrganizationId: string;
        sourceClub: string;
      }>;
    }>;
  }>;
};

@Injectable()
export class LeaderMeetingService {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityService,
    private readonly finance: FinanceCalculationService,
    private readonly validation: RegistrationValidationService,
  ) {}

  async meetingStatus(db: DbLike, activityId: string) {
    return db.leaderMeeting.findUnique({ where: { activityId }, select: { status: true } });
  }

  private async access(request: RequestContext, activityId: string, admin = false): Promise<MeetingAccess> {
    const actor = await this.identity.authenticate(request);
    const assignments = await this.db.activityStaff.findMany({
      where: { userId: actor.user.id, activityId, revokedAt: null },
      select: { role: true },
    });
    const staffRole = assignments.some((item) => item.role === "SYSTEM_ADMIN")
      ? "SYSTEM_ADMIN"
      : assignments.some((item) => item.role === "REGISTRATION_FINANCE")
        ? "REGISTRATION_FINANCE"
        : assignments.some((item) => item.role === "CHECKIN_EXPORT")
          ? "CHECKIN_EXPORT"
          : null;
    if (admin) {
      if (staffRole !== "SYSTEM_ADMIN") fail("FORBIDDEN", "只有系統管理員可以控制領隊會議", 403);
      return { actorId: actor.user.id, staffRole, organizationIds: [] };
    }
    const memberships = await this.db.organizationMembership.findMany({
      where: { userId: actor.user.id, revokedAt: null, organization: { activityId, active: true } },
      select: { organizationId: true },
    });
    if (!staffRole && !memberships.length) fail("FORBIDDEN", "您沒有此活動的領隊會議權限", 403);
    return { actorId: actor.user.id, staffRole, organizationIds: memberships.map((item) => item.organizationId) };
  }

  private async registrationIds(db: DbLike, activityId: string, organizationIds: string[]) {
    if (!organizationIds.length) return [];
    const registrations = await db.registration.findMany({
      where: {
        activityId,
        status: "CONFIRMED",
        OR: [
          { organizationId: { in: organizationIds } },
          { league: { ownerOrganizationId: { in: organizationIds } } },
        ],
      },
      select: { id: true },
    });
    return registrations.map((item) => item.id);
  }

  private async calculations(db: DbLike, activityId: string, registrationIds?: string[]) {
    const registrations = await db.registration.findMany({
      where: {
        activityId,
        status: "CONFIRMED",
        ...(registrationIds ? { id: { in: registrationIds } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    const items = [];
    for (const registration of registrations) items.push(await this.finance.calculate(db, registration.id));
    return {
      registrations: items.map((item) => ({
        registrationId: item.registrationId,
        amountDue: item.amountDue,
        netPaid: item.netPaid,
        balanceDue: item.balanceDue,
        credit: item.credit,
        financiallyEligible: item.financiallyEligible,
      })),
      amountDue: items.reduce((sum, item) => sum + item.amountDue, 0),
      confirmedPayments: items.reduce((sum, item) => sum + item.confirmedPayments, 0),
      completedRefunds: items.reduce((sum, item) => sum + item.completedRefunds, 0),
      netPaid: items.reduce((sum, item) => sum + item.netPaid, 0),
      balanceDue: items.reduce((sum, item) => sum + item.balanceDue, 0),
      credit: items.reduce((sum, item) => sum + item.credit, 0),
      financiallyEligible: items.every((item) => item.financiallyEligible),
    };
  }

  private async snapshotPayload(db: DbLike, activityId: string): Promise<SnapshotRegistration[]> {
    const registrations = await db.registration.findMany({
      where: { activityId, status: "CONFIRMED" },
      orderBy: { id: "asc" },
      include: {
        organization: { select: { id: true, name: true } },
        league: { select: { id: true, name: true } },
        eventEntries: {
          where: { active: true },
          orderBy: { id: "asc" },
          include: {
            event: { select: { id: true, name: true } },
            teams: {
              orderBy: [{ ordinal: "asc" }, { id: "asc" }],
              include: {
                members: {
                  where: { active: true, participant: { active: true } },
                  orderBy: [{ participantId: "asc" }, { id: "asc" }],
                  include: {
                    participant: {
                      select: {
                        id: true,
                        name: true,
                        gender: true,
                        grade: true,
                        sourceOrganizationId: true,
                        sourceOrganization: { select: { name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const payload: SnapshotRegistration[] = [];
    for (const registration of registrations) {
      const financial = await this.finance.calculate(db, registration.id);
      const unit = registration.organization
        ? { id: registration.organization.id, name: registration.organization.name, kind: "CLUB" as const }
        : { id: registration.league!.id, name: registration.league!.name, kind: "LEAGUE" as const };
      payload.push({
        registrationId: registration.id,
        unit,
        status: registration.status,
        finance: {
          amountDue: financial.amountDue,
          netPaid: financial.netPaid,
          balanceDue: financial.balanceDue,
          credit: financial.credit,
          financiallyEligible: financial.financiallyEligible,
        },
        eventEntries: registration.eventEntries.map((entry) => ({
          eventId: entry.event.id,
          eventName: entry.event.name,
          teams: entry.teams.map((team) => ({
            teamId: team.id,
            ordinal: team.ordinal,
            admissionStatus: team.admissionStatus,
            members: team.members.map((member) => ({
              participantId: member.participant.id,
              name: member.participant.name,
              gender: member.participant.gender,
              grade: member.participant.grade,
              sourceOrganizationId: member.participant.sourceOrganizationId,
              sourceClub: member.participant.sourceOrganization.name,
            })),
          })),
        })),
      });
    }
    return payload;
  }

  private async capture(tx: Tx, meetingId: string, activityId: string, kind: "BASELINE" | "FINAL", actorId: string) {
    const existing = await tx.leaderMeetingSnapshot.findUnique({ where: { leaderMeetingId_kind: { leaderMeetingId: meetingId, kind } } });
    if (existing) return existing;
    const captured = await this.snapshotPayload(tx, activityId);
    const payload = kind === "FINAL"
      ? captured.map((registration) => ({
          ...registration,
          eventEntries: registration.eventEntries.map((entry) => ({
            ...entry,
            teams: entry.teams.filter((team) => team.admissionStatus === "ADMITTED"),
          })),
        }))
      : captured;
    const amountDue = payload.reduce((sum, registration) => sum + registration.finance.amountDue, 0);
    return tx.leaderMeetingSnapshot.create({
      data: { leaderMeetingId: meetingId, kind, amountDue, payload: payload as unknown as Prisma.InputJsonValue, createdById: actorId },
    });
  }

  private scopedSnapshot(snapshot: { id: string; kind: string; amountDue: number; capturedAt: Date; payload: Prisma.JsonValue }, access: MeetingAccess, registrationIds: string[]) {
    if (access.staffRole === "SYSTEM_ADMIN") return snapshot;
    if (access.staffRole === "REGISTRATION_FINANCE")
      return { id: snapshot.id, kind: snapshot.kind, amountDue: snapshot.amountDue, capturedAt: snapshot.capturedAt };
    if (access.staffRole === "CHECKIN_EXPORT")
      return { id: snapshot.id, kind: snapshot.kind, capturedAt: snapshot.capturedAt };
    const payload = (Array.isArray(snapshot.payload) ? snapshot.payload : []) as unknown as SnapshotRegistration[];
    const scoped = payload.filter((registration) => registrationIds.includes(registration.registrationId));
    return {
      id: snapshot.id,
      kind: snapshot.kind,
      amountDue: scoped.reduce((sum, registration) => sum + (registration.finance?.amountDue ?? 0), 0),
      capturedAt: snapshot.capturedAt,
      payload: scoped,
    };
  }

  async get(request: RequestContext, activityId: string) {
    parse(uuid, activityId);
    const access = await this.access(request, activityId);
    const activity = await this.db.activity.findUnique({ where: { id: activityId }, select: { leaderMeetingStartsAt: true, leaderMeetingEndsAt: true, competitionStartsAt: true } });
    if (!activity) fail("NOT_FOUND", "找不到年度活動", 404);
    const meeting = await this.db.leaderMeeting.findUnique({ where: { activityId }, include: { snapshots: { orderBy: { capturedAt: "asc" } } } });
    const registrationIds = access.staffRole ? [] : await this.registrationIds(this.db, activityId, access.organizationIds);
    const reconciliation = access.staffRole === "CHECKIN_EXPORT"
      ? null
      : await this.calculations(this.db, activityId, access.staffRole ? undefined : registrationIds);
    const now = new Date();
    const confirmedRegistrationCount = access.staffRole
      ? await this.db.registration.count({ where: { activityId, status: "CONFIRMED" } })
      : registrationIds.length;
    const meetingStatus = meeting?.status ?? "SCHEDULED";
    const readiness = meetingStatus === "CLOSED"
      ? "CLOSED"
      : meetingStatus === "ENTRY_OPEN"
        ? "IN_PROGRESS"
        : meetingStatus === "ENTRY_CLOSED_PARTICIPANT_OPEN"
          ? "PARTICIPANT_ADJUSTMENT"
          : activity.competitionStartsAt && now >= activity.competitionStartsAt
            ? "COMPETITION_STARTED"
            : activity.leaderMeetingStartsAt && now < activity.leaderMeetingStartsAt
              ? "NOT_YET_READY"
              : "READY_TO_START";
    const snapshots = meeting?.snapshots.map((snapshot) => this.scopedSnapshot(snapshot, access, registrationIds)) ?? [];
    return {
      activityId,
      status: meetingStatus,
      rowVersion: meeting?.rowVersion ?? 1,
      startedAt: meeting?.startedAt ?? null,
      entryClosedAt: meeting?.entryClosedAt ?? null,
      closedAt: meeting?.closedAt ?? null,
      leaderMeetingStartsAt: activity.leaderMeetingStartsAt,
      leaderMeetingEndsAt: activity.leaderMeetingEndsAt,
      competitionStartsAt: activity.competitionStartsAt,
      readiness,
      confirmedRegistrationCount,
      baseline: snapshots.find((item) => item.kind === "BASELINE") ?? null,
      final: snapshots.find((item) => item.kind === "FINAL") ?? null,
      reconciliation,
    };
  }

  async addAdmissionEntry(request: RequestContext, activityId: string, input: unknown) {
    parse(uuid, activityId);
    const access = await this.access(request, activityId, true);
    const data = parse(admissionEntryInput, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `leader-meeting:${activityId}`);
      await lock(tx, `event-admission:${data.eventId}`);
      const meeting = await tx.leaderMeeting.findUnique({ where: { activityId } });
      if (!meeting || meeting.status !== "ENTRY_OPEN")
        fail("LEADER_MEETING_TRANSITION_INVALID", "只有賽事項目與隊伍異動開放期間可以輸入加報", 409);
      const [activity, registration, event] = await Promise.all([
        tx.activity.findUnique({ where: { id: activityId } }),
        tx.registration.findUnique({ where: { id: data.registrationId }, include: { eventEntries: { where: { eventId: data.eventId }, include: { teams: { select: { id: true } } } } } }),
        tx.competitionEvent.findUnique({ where: { id: data.eventId } }),
      ]);
      if (!activity || !registration || registration.activityId !== activityId || registration.status !== "CONFIRMED")
        fail("REGISTRATION_NOT_ELIGIBLE", "只能替已確認報名的單位輸入加報", 422);
      if (!event || event.activityId !== activityId || !event.enabled)
        fail("NOT_FOUND", "找不到可用的賽事項目", 404);
      const isLeague = Boolean(registration.leagueId);
      if (isLeague ? !event.allowLeague : !event.allowClub)
        fail("VALIDATION_FAILED", "此賽事項目不接受此報名單位", 422);
      const published = await tx.scheduleVersion.findFirst({ where: { activityId, status: "PUBLISHED", timeWindows: { some: { eventId: event.id } } }, select: { id: true } });
      if (!published) fail("VALIDATION_FAILED", "目前賽事項目尚未正式發布，無法輸入加報", 422);
      const existing = registration.eventEntries[0];
      if (existing?.active) fail("DUPLICATE_RECORD", "此報名單位已加入該賽事項目", 409);
      if (existing?.teams.length) fail("DUPLICATE_RECORD", "此報名單位已有該賽事項目的隊伍紀錄，請先處理原有紀錄", 409);
      const occupied = await tx.team.count({ where: { eventEntry: { activityId, eventId: event.id, active: true }, admissionStatus: { not: "REJECTED" } } });
      if (event.teamCapacity !== null && occupied >= event.teamCapacity)
        fail("EVENT_CAPACITY_EXCEEDED", "此賽事項目目前已無可加報名額", 409);
      const entry = existing
        ? await tx.eventEntry.update({ where: { id: existing.id }, data: { active: true, source: "LEADER_MEETING", rowVersion: { increment: 1 } } })
        : await tx.eventEntry.create({ data: { activityId, registrationId: registration.id, eventId: event.id, source: "LEADER_MEETING" } });
      const team = await tx.team.create({ data: { eventEntryId: entry.id, ordinal: 1, admissionStatus: "PENDING" } });
      await tx.registration.update({ where: { id: registration.id, rowVersion: registration.rowVersion }, data: { rowVersion: { increment: 1 } } });
      
      return { entry, team };
    });
  }

  async mutate(request: RequestContext, activityId: string, action: string, input: unknown) {
    parse(uuid, activityId);
    transition.parse(action);
    const access = await this.access(request, activityId, true);
    parse(transitionInput, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `leader-meeting:${activityId}`);
      const activity = await tx.activity.findUnique({ where: { id: activityId } });
      if (!activity) fail("NOT_FOUND", "找不到年度活動", 404);
      if (activity.competitionStartsAt && new Date() >= activity.competitionStartsAt)
        fail("ACTIVITY_STAGE_FORBIDS_ACTION", "比賽已開始，領隊會議不可變更", 409);
      let meeting = await tx.leaderMeeting.findUnique({ where: { activityId } });
      if (!meeting) meeting = await tx.leaderMeeting.create({ data: { activityId } });
      if (action === "start") {
        if (activity.leaderMeetingStartsAt && new Date() < activity.leaderMeetingStartsAt)
          fail("LEADER_MEETING_NOT_READY", "尚未到領隊會議開始時間", 409);
        if (meeting.status !== "SCHEDULED") return meeting;
        await this.capture(tx, meeting.id, activityId, "BASELINE", access.actorId);
        const updated = await tx.leaderMeeting.update({
          where: { id: meeting.id, rowVersion: meeting.rowVersion },
          data: { status: "ENTRY_OPEN", startedAt: new Date(), startedById: access.actorId, rowVersion: { increment: 1 } },
        });
        
        return updated;
      }
      if (action === "close-entry") {
        if (meeting.status !== "ENTRY_OPEN") fail("LEADER_MEETING_TRANSITION_INVALID", "目前不可結束賽事項目異動", 409);
        const updated = await tx.leaderMeeting.update({
          where: { id: meeting.id, rowVersion: meeting.rowVersion },
          data: { status: "ENTRY_CLOSED_PARTICIPANT_OPEN", entryClosedAt: new Date(), entryClosedById: access.actorId, rowVersion: { increment: 1 } },
        });
        
        return updated;
      }
      if (meeting.status === "CLOSED") return meeting;
      if (meeting.status !== "ENTRY_CLOSED_PARTICIPANT_OPEN")
        fail("LEADER_MEETING_TRANSITION_INVALID", "請先結束賽事項目異動", 409);

      const pendingTeams = await tx.team.findMany({
        where: {
          admissionStatus: "PENDING",
          eventEntry: { activityId, active: true, registration: { status: "CONFIRMED" } },
        },
        select: { id: true, ordinal: true, eventEntry: { select: { registrationId: true, event: { select: { name: true } } } } },
        orderBy: { id: "asc" },
      });
      if (pendingTeams.length)
        fail("TEAM_ADMISSION_PENDING", "尚有待主辦錄取的隊伍，請先到報名審核完成錄取或拒絕", 409, {
          path: "報名審核 → 待主辦處理隊伍",
          teams: pendingTeams,
        });

      const confirmedRegistrations = await tx.registration.findMany({
        where: { activityId, status: "CONFIRMED" },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      const invalid = [];
      for (const registration of confirmedRegistrations) {
        const result = await this.validation.validate(tx, registration.id, { officialFinal: true });
        if (result.blockers.length) invalid.push({ registrationId: registration.id, blockers: result.blockers });
      }
      if (invalid.length)
        fail("LEADER_MEETING_FINAL_DATA_INVALID", "仍有報名單位未通過最終資料驗證", 409, { registrations: invalid });

      const financial = await this.calculations(tx, activityId);
      const unsettled = financial.registrations.filter((registration) => !registration.financiallyEligible);
      if (unsettled.length)
        fail("LEADER_MEETING_FINANCE_NOT_READY", "仍有報名單位未完成目前正式錄取項目的財務結算", 409, { registrations: unsettled });

      const finalSnapshot = await this.capture(tx, meeting.id, activityId, "FINAL", access.actorId);
      const updated = await tx.leaderMeeting.update({
        where: { id: meeting.id, rowVersion: meeting.rowVersion },
        data: { status: "CLOSED", closedAt: new Date(), closedById: access.actorId, rowVersion: { increment: 1 } },
      });
      
      return updated;
    });
  }
}
