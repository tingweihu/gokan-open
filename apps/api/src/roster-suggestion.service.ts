import { Injectable } from "@nestjs/common";
import { Prisma, type Registration } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Database, fail, lock, parse, uuid, version, type RequestContext } from "./core.js";
import { IdentityService } from "./identity.service.js";
import { CompetitionService } from "./competition.service.js";
import { suggestRoster } from "./roster-suggestion.js";
import { optimizeRegistration, type RegistrationOptimizerInput } from "./registration-roster-optimizer.js";
import { RegistrationValidationService } from "./registration-validation.service.js";
import { assertStage, operatingStage } from "./stage.js";

const activeOptimizerRegistrations = new Set<string>();
const optimizerRequests = new Map<string, number[]>();
const optimizerWindowMs = 60_000;

function optimizerThrottle(actorId: string, registrationId: string, operation: "preview" | "apply") {
  const now = Date.now();
  const key = `${actorId}:${registrationId}:${operation}`;
  const recent = (optimizerRequests.get(key) ?? []).filter((timestamp) => now - timestamp < optimizerWindowMs);
  const limit = operation === "preview" ? 8 : 3;
  if (recent.length >= limit)
    fail("OPTIMIZER_RATE_LIMITED", "智慧配置要求過於頻繁，請稍後再試", 429, { retryAfterSeconds: 60 });
  recent.push(now);
  optimizerRequests.set(key, recent);
}

const registrationSuggestionApply = z.object({
  registrationRowVersion: version.optional(),
  rowVersion: version.optional(),
  entryRowVersions: z.record(z.string().uuid(), version).default({}),
  teamRowVersions: z.record(z.string().uuid(), version).default({}),
  participantRowVersions: z.record(z.string().uuid(), version).default({}),
  fingerprint: z.string().trim().length(64),
}).strict().superRefine((value, context) => {
  if (value.registrationRowVersion === undefined && value.rowVersion === undefined)
    context.addIssue({ code: "custom", path: ["registrationRowVersion"], message: "缺少報名版本" });
});

@Injectable()
export class RosterSuggestionService {
  constructor(private readonly db: Database, private readonly identity: IdentityService, private readonly competition: CompetitionService, private readonly validation: RegistrationValidationService) {}

  private async assertOptimizerAvailable(
    db: Database | Prisma.TransactionClient,
    registration: Registration & { eventEntries?: { id: string }[] },
  ) {
    if (!(["DRAFT", "RETURNED"] as string[]).includes(registration.status))
      fail("ROSTER_OPTIMIZER_STAGE_FORBIDDEN", "智慧配置僅供送出前或退回修正中的報名使用", 409);
    const activity = await db.activity.findUnique({ where: { id: registration.activityId } });
    if (!activity) fail("NOT_FOUND", "找不到活動", 404);
    const meeting = await db.leaderMeeting.findUnique({ where: { activityId: registration.activityId }, select: { status: true } });
    if (meeting && meeting.status !== "SCHEDULED")
      fail("ROSTER_OPTIMIZER_STAGE_FORBIDDEN", "智慧配置不在領隊會議或最終確認階段提供", 409);
    const stage = operatingStage(activity);
    if (stage === "LEADER_MEETING" || stage === "POST_LEADER_MEETING" || stage === "COMPETITION" || stage === "CLOSEOUT")
      fail("ROSTER_OPTIMIZER_STAGE_FORBIDDEN", "智慧配置僅供初始報名與退回修正使用", 409);
    assertStage(activity, registration, "team", new Date(), meeting?.status);
  }

  private async runOptimizer<T>(registrationId: string, work: () => Promise<T>) {
    if (activeOptimizerRegistrations.has(registrationId))
      fail("OPTIMIZER_BUSY", "此報名正在進行智慧配置，請稍後再試", 429);
    activeOptimizerRegistrations.add(registrationId);
    try {
      return await work();
    } finally {
      activeOptimizerRegistrations.delete(registrationId);
    }
  }
  async suggest(request: RequestContext, entryId: string) {
    parse(uuid, entryId);
    const actor = await this.identity.authenticate(request);
    const entry = await this.db.eventEntry.findUnique({ where: { id: entryId }, include: { registration: true, event: true, teams: { include: { members: { where: { active: true } } } } } });
    if (!entry) fail("NOT_FOUND", "找不到賽事報名", 404);
    await this.competition.registrationScope(this.db, actor.user.id, entry.registration);
    await this.assertOptimizerAvailable(this.db, entry.registration);
    optimizerThrottle(actor.user.id, entry.registrationId, "preview");
    const sources = entry.registration.organizationId ? [entry.registration.organizationId] : (await this.db.leagueMember.findMany({ where: { leagueId: entry.registration.leagueId ?? "", status: "CONFIRMED" }, select: { organizationId: true } })).map((item) => item.organizationId);
    const participants = await this.db.participant.findMany({ where: { activityId: entry.activityId, active: true, sourceOrganizationId: { in: sources } }, select: { id: true, gender: true, grade: true, sourceOrganizationId: true } });
    const claims = await this.db.participantEventClaim.findMany({ where: { activityId: entry.activityId, eventId: entry.eventId }, select: { participantId: true } });
    return this.runOptimizer(entry.registrationId, () => Promise.resolve({ entryId, entryRowVersion: entry.rowVersion, teamRowVersions: Object.fromEntries(entry.teams.map((team) => [team.id, team.rowVersion])), ...suggestRoster({ event: entry.event, teams: entry.teams.filter((team) => team.admissionStatus !== "REJECTED").map((team) => ({ id: team.id, ordinal: team.ordinal, participantIds: team.members.map((member) => member.participantId) })), participants, claimedParticipantIds: claims.map((claim) => claim.participantId), allowedSourceOrganizationIds: sources }) }));
  }

  async apply(request: RequestContext, entryId: string, input: unknown) {
    parse(uuid, entryId);
    const actor = await this.identity.authenticate(request);
    const data = parse(z.object({ rowVersion: version, teamRowVersions: z.record(z.string().uuid(), version) }).strict(), input);
    const ref = await this.db.eventEntry.findUnique({ where: { id: entryId }, include: { registration: true } });
    if (!ref) fail("NOT_FOUND", "找不到賽事報名", 404);
    await this.competition.registrationScope(this.db, actor.user.id, ref.registration, false, Boolean(ref.registration.leagueId));
    await this.assertOptimizerAvailable(this.db, ref.registration);
    optimizerThrottle(actor.user.id, ref.registrationId, "apply");
    return this.runOptimizer(ref.registrationId, () => this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${entryId}`);
      const entry = await tx.eventEntry.findUnique({ where: { id: entryId }, include: { registration: true, event: true, teams: { include: { members: { where: { active: true } } } } } });
      if (!entry) fail("NOT_FOUND", "找不到賽事報名", 404);
      await this.competition.registrationScope(tx, actor.user.id, entry.registration, false, Boolean(entry.registration.leagueId));
      await this.assertOptimizerAvailable(tx, entry.registration);
      if (entry.rowVersion !== data.rowVersion) fail("STALE_VERSION", "賽事報名已更新，請重新整理後再試");
      for (const team of entry.teams) if (data.teamRowVersions[team.id] !== team.rowVersion) fail("STALE_VERSION", "隊伍已被其他人更新，請重新整理後再試");
      const sources = entry.registration.organizationId
        ? [entry.registration.organizationId]
        : (await tx.leagueMember.findMany({ where: { leagueId: entry.registration.leagueId ?? "", status: "CONFIRMED" }, select: { organizationId: true } })).map((item) => item.organizationId);
      const participants = await tx.participant.findMany({ where: { activityId: entry.activityId, active: true, sourceOrganizationId: { in: sources } }, select: { id: true, gender: true, grade: true, sourceOrganizationId: true } });
      const claims = await tx.participantEventClaim.findMany({ where: { activityId: entry.activityId, eventId: entry.eventId }, select: { participantId: true } });
      const suggestion = suggestRoster({ event: entry.event, teams: entry.teams.filter((team) => team.admissionStatus !== "REJECTED").map((team) => ({ id: team.id, ordinal: team.ordinal, participantIds: team.members.map((member) => member.participantId) })), participants, claimedParticipantIds: claims.map((claim) => claim.participantId), allowedSourceOrganizationIds: sources });
      if (suggestion.blockers.length) fail("TEAM_COMPOSITION_INVALID", suggestion.blockers[0]!, 422, suggestion);
      let added = 0;
      for (const assignment of suggestion.assignments) {
        const team = entry.teams.find((item) => item.id === assignment.teamId);
        if (!team) fail("STALE_VERSION", "隊伍已被其他人更新，請重新整理後再試");
        const current = new Set(team.members.map((member) => member.participantId));
        let teamAdded = 0;
        for (const participantId of assignment.participantIds) {
          if (current.has(participantId)) continue;
          await this.competition.participantForAssignment(tx, entry.registration, participantId);
          await this.competition.checkTimeConflict(tx, entry, participantId);
          try {
            const inactive = await tx.teamMember.findFirst({ where: { eventEntryId: entry.id, participantId, active: false } });
            if (inactive) await tx.teamMember.update({ where: { id: inactive.id }, data: { teamId: team.id, active: true, removedAt: null, rowVersion: { increment: 1 } } });
            else await tx.teamMember.create({ data: { activityId: entry.activityId, eventEntryId: entry.id, teamId: team.id, participantId } });
            await tx.participantEventClaim.create({ data: { activityId: entry.activityId, eventId: entry.eventId, participantId, registrationId: entry.registrationId, eventEntryId: entry.id } });
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") fail("PARTICIPANT_EVENT_ALREADY_CLAIMED", "選手已被其他報名單位使用此賽事", 409, { participantId, eventId: entry.eventId });
            throw error;
          }
          current.add(participantId);
          added++; teamAdded++;
        }
        if (teamAdded) await tx.team.update({ where: { id: team.id, rowVersion: team.rowVersion }, data: { rowVersion: { increment: 1 } } });
      }
      if (added) await tx.eventEntry.update({ where: { id: entry.id, rowVersion: data.rowVersion }, data: { rowVersion: { increment: 1 } } });
      
      return { entryId: entry.id, added, teams: await tx.team.findMany({ where: { eventEntryId: entry.id }, include: { members: { where: { active: true }, include: { participant: true } } }, orderBy: { ordinal: "asc" } }) };
    }));
  }

  private async registrationSnapshot(db: Database | Prisma.TransactionClient, registrationId: string) {
    const registration = await db.registration.findUnique({
      where: { id: registrationId },
      include: {
        organization: true,
        league: { include: { members: true } },
        eventEntries: {
          where: { active: true },
          orderBy: [{ eventId: "asc" }, { id: "asc" }],
          include: {
            event: true,
            teams: { orderBy: [{ ordinal: "asc" }, { id: "asc" }], include: { members: { where: { active: true }, orderBy: [{ participantId: "asc" }, { id: "asc" }], include: { participant: true } } } },
          },
        },
      },
    });
    if (!registration) fail("NOT_FOUND", "找不到報名", 404);
    const allowedSourceOrganizationIds = registration.organizationId
      ? (registration.organization?.active ? [registration.organizationId] : [])
      : (registration.league?.members.filter((member) => member.status === "CONFIRMED").map((member) => member.organizationId) ?? []);
    const [participants, published, admittedTeams] = await Promise.all([
      db.participant.findMany({ where: { activityId: registration.activityId, active: true, sourceOrganizationId: { in: allowedSourceOrganizationIds } }, orderBy: { id: "asc" }, select: { id: true, name: true, gender: true, grade: true, sourceOrganizationId: true, rowVersion: true } }),
      db.scheduleVersion.findFirst({ where: { activityId: registration.activityId, status: "PUBLISHED" }, orderBy: { version: "desc" }, include: { timeWindows: { orderBy: [{ eventId: "asc" }, { ordinal: "asc" }, { id: "asc" }] } } }),
      db.team.findMany({
        where: { admissionStatus: "ADMITTED", eventEntry: { activityId: registration.activityId, active: true } },
        select: { eventEntry: { select: { eventId: true } } },
      }),
    ]);
    const claims = await db.participantEventClaim.findMany({ where: { activityId: registration.activityId }, orderBy: [{ eventId: "asc" }, { participantId: "asc" }, { id: "asc" }], select: { participantId: true, eventId: true, registrationId: true } });
    const admittedTeamCounts: Record<string, number> = {};
    for (const team of admittedTeams) admittedTeamCounts[team.eventEntry.eventId] = (admittedTeamCounts[team.eventEntry.eventId] ?? 0) + 1;
    return { registration, allowedSourceOrganizationIds, participants, published, claims, admittedTeamCounts };
  }

  private fingerprint(snapshot: Awaited<ReturnType<RosterSuggestionService["registrationSnapshot"]>>) {
    const canonical = {
      registration: { id: snapshot.registration.id, rowVersion: snapshot.registration.rowVersion, status: snapshot.registration.status },
      entries: snapshot.registration.eventEntries.map((entry) => ({ id: entry.id, eventId: entry.eventId, rowVersion: entry.rowVersion, eventRowVersion: entry.event.rowVersion, teams: entry.teams.map((team) => ({ id: team.id, rowVersion: team.rowVersion, members: team.members.map((member) => ({ participantId: member.participantId, rowVersion: member.rowVersion })) })) })),
      participants: snapshot.participants.map((participant) => ({ id: participant.id, rowVersion: participant.rowVersion, active: true, sourceOrganizationId: participant.sourceOrganizationId, gender: participant.gender, grade: participant.grade })),
      claims: snapshot.claims.map((claim) => ({ participantId: claim.participantId, eventId: claim.eventId, registrationId: claim.registrationId })).sort((left, right) => `${left.eventId}:${left.participantId}:${left.registrationId}`.localeCompare(`${right.eventId}:${right.participantId}:${right.registrationId}`)),
      unitScope: {
        allowedSourceOrganizationIds: [...snapshot.allowedSourceOrganizationIds].sort(),
        organization: snapshot.registration.organization ? { id: snapshot.registration.organization.id, active: snapshot.registration.organization.active, rowVersion: snapshot.registration.organization.rowVersion } : null,
        leagueMembers: snapshot.registration.league?.members.map((member) => ({ id: member.id, organizationId: member.organizationId, status: member.status })).sort((left, right) => left.id.localeCompare(right.id)) ?? [],
      },
      schedule: snapshot.published ? { id: snapshot.published.id, rowVersion: snapshot.published.rowVersion, windows: snapshot.published.timeWindows.map((window) => ({ id: window.id, eventId: window.eventId, startAt: window.startAt.toISOString(), endAt: window.endAt.toISOString(), ordinal: window.ordinal })).sort((left, right) => left.id.localeCompare(right.id)) } : null,
      admittedTeamCounts: Object.entries(snapshot.admittedTeamCounts).sort(([left], [right]) => left.localeCompare(right)),
    };
    return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  }

  private optimizerInput(snapshot: Awaited<ReturnType<RosterSuggestionService["registrationSnapshot"]>>): RegistrationOptimizerInput {
    const { registration, participants, published, claims, allowedSourceOrganizationIds } = snapshot;
    return {
      registrationId: registration.id,
      unitKind: registration.organizationId ? "CLUB" : "LEAGUE",
      allowedSourceOrganizationIds,
      participants,
      claims,
      windows: published?.timeWindows ?? [],
      entries: registration.eventEntries.map((entry) => ({
        id: entry.id,
        eventId: entry.eventId,
        active: entry.active,
        rowVersion: entry.rowVersion,
        event: { ...entry.event, admittedTeamCount: snapshot.admittedTeamCounts[entry.eventId] ?? 0 },
        teams: entry.teams.map((team) => ({ id: team.id, ordinal: team.ordinal, admissionStatus: team.admissionStatus, rowVersion: team.rowVersion, participantIds: team.members.map((member) => member.participantId) })),
      })),
    };
  }

  private formatRegistrationSuggestion(snapshot: Awaited<ReturnType<RosterSuggestionService["registrationSnapshot"]>>) {
    const result = optimizeRegistration(this.optimizerInput(snapshot));
    return {
      ...result,
      participants: snapshot.participants.filter((participant) => snapshot.allowedSourceOrganizationIds.includes(participant.sourceOrganizationId)),
      fingerprint: this.fingerprint(snapshot),
      registrationRowVersion: snapshot.registration.rowVersion,
      rowVersion: snapshot.registration.rowVersion,
      entryRowVersions: Object.fromEntries(snapshot.registration.eventEntries.map((entry) => [entry.id, entry.rowVersion])),
      teamRowVersions: Object.fromEntries(snapshot.registration.eventEntries.flatMap((entry) => entry.teams.map((team) => [team.id, team.rowVersion]))),
      participantRowVersions: Object.fromEntries(snapshot.participants.filter((participant) => snapshot.allowedSourceOrganizationIds.includes(participant.sourceOrganizationId)).map((participant) => [participant.id, participant.rowVersion])),
    };
  }

  async registrationSuggest(request: RequestContext, registrationId: string) {
    parse(uuid, registrationId);
    const actor = await this.identity.authenticate(request);
    const snapshot = await this.registrationSnapshot(this.db, registrationId);
    await this.competition.registrationScope(this.db, actor.user.id, snapshot.registration, false, Boolean(snapshot.registration.leagueId));
    await this.assertOptimizerAvailable(this.db, snapshot.registration);
    optimizerThrottle(actor.user.id, registrationId, "preview");
    return this.runOptimizer(registrationId, () => Promise.resolve(this.formatRegistrationSuggestion(snapshot)));
  }

  async registrationApply(request: RequestContext, registrationId: string, input: unknown) {
    parse(uuid, registrationId);
    const actor = await this.identity.authenticate(request);
    const data = parse(registrationSuggestionApply, input);
    const authorizedSnapshot = await this.registrationSnapshot(this.db, registrationId);
    await this.competition.registrationScope(this.db, actor.user.id, authorizedSnapshot.registration, false, Boolean(authorizedSnapshot.registration.leagueId));
    await this.assertOptimizerAvailable(this.db, authorizedSnapshot.registration);
    optimizerThrottle(actor.user.id, registrationId, "apply");
    return this.runOptimizer(registrationId, () => this.db.$transaction(async (tx) => {
      const registrationRef = await tx.registration.findUnique({ where: { id: registrationId }, select: { activityId: true } });
      if (!registrationRef) fail("NOT_FOUND", "找不到報名", 404);
      await lock(tx, `activity:${registrationRef.activityId}`);
      await lock(tx, `registration:${registrationId}`);
      const snapshot = await this.registrationSnapshot(tx, registrationId);
      await this.competition.registrationScope(tx, actor.user.id, snapshot.registration, false, Boolean(snapshot.registration.leagueId));
      await this.assertOptimizerAvailable(tx, snapshot.registration);
      const expectedRegistrationVersion = data.registrationRowVersion ?? data.rowVersion;
      if (snapshot.registration.rowVersion !== expectedRegistrationVersion) fail("STALE_VERSION", "報名資料已被其他人更新，請重新整理");
      for (const entry of snapshot.registration.eventEntries) {
        if (data.entryRowVersions[entry.id] !== undefined && data.entryRowVersions[entry.id] !== entry.rowVersion) fail("STALE_VERSION", "賽事報名已被其他人更新，請重新整理");
        for (const team of entry.teams) if (data.teamRowVersions[team.id] !== undefined && data.teamRowVersions[team.id] !== team.rowVersion) fail("STALE_VERSION", "隊伍已被其他人更新，請重新整理");
      }
      for (const participant of snapshot.participants) if (data.participantRowVersions[participant.id] !== undefined && data.participantRowVersions[participant.id] !== participant.rowVersion) fail("STALE_VERSION", "選手名單已被其他人更新，請重新整理");
      const currentFingerprint = this.fingerprint(snapshot);
      if (data.fingerprint && data.fingerprint !== currentFingerprint) fail("STALE_VERSION", "選手、賽事或正式時程已更新，請重新產生建議");
      let suggestion = optimizeRegistration(this.optimizerInput(snapshot));
      if (suggestion.outcome === "OPTIMIZATION_LIMIT_REACHED")
        fail("OPTIMIZATION_LIMIT_REACHED", "智慧配置已達安全運算上限，請縮小範圍後重試", 422, suggestion);
      if (suggestion.outcome === "NO_FEASIBLE_SOLUTION")
        fail("NO_FEASIBLE_SOLUTION", "目前條件無法完成整份配置", 422, suggestion);
      for (const event of suggestion.events.filter((item) => item.willCreateTeamA)) {
        const entry = snapshot.registration.eventEntries.find((item) => item.id === event.entryId);
        if (!entry) fail("STALE_VERSION", "賽事報名已更新，請重新整理");
        await this.competition.createPrimaryTeamForOptimizer(tx, actor.user.id, entry.id, entry.rowVersion);
      }
      const workingSnapshot = suggestion.events.some((item) => item.willCreateTeamA)
        ? await this.registrationSnapshot(tx, registrationId)
        : snapshot;
      suggestion = optimizeRegistration(this.optimizerInput(workingSnapshot));
      if (suggestion.outcome !== "COMPLETE")
        fail(suggestion.outcome, suggestion.outcome === "OPTIMIZATION_LIMIT_REACHED" ? "智慧配置已達安全運算上限" : "最新資料已無法完成合法配置", 422, suggestion);
      const entriesById = new Map(workingSnapshot.registration.eventEntries.map((entry) => [entry.id, entry]));
      const entryVersions = new Map(workingSnapshot.registration.eventEntries.map((entry) => [entry.id, entry.rowVersion]));
      let added = 0;
      for (const assignment of suggestion.assignments) {
        const entry = [...entriesById.values()].find((candidate) => candidate.teams.some((team) => team.id === assignment.teamId));
        const team = entry?.teams.find((candidate) => candidate.id === assignment.teamId);
        if (!entry || !team) fail("STALE_VERSION", "隊伍已被其他人更新，請重新整理");
        const currentIds = new Set(team.members.map((member) => member.participantId));
        const addedIds = assignment.participantIds.filter((participantId) => !currentIds.has(participantId));
        for (const participantId of addedIds) {
          await this.competition.participantForAssignment(tx, workingSnapshot.registration, participantId);
          await this.competition.checkTimeConflict(tx, entry, participantId);
          if (await tx.teamMember.findFirst({ where: { eventEntryId: entry.id, participantId, active: true } })) fail("TEAM_MEMBER_DUPLICATE", "選手已在此賽事的其他隊伍", 409);
          try {
            const inactive = await tx.teamMember.findFirst({ where: { eventEntryId: entry.id, participantId, active: false } });
            if (inactive) await tx.teamMember.update({ where: { id: inactive.id }, data: { teamId: team.id, active: true, removedAt: null, rowVersion: { increment: 1 } } });
            else await tx.teamMember.create({ data: { activityId: entry.activityId, eventEntryId: entry.id, teamId: team.id, participantId } });
            const ownClaim = await tx.participantEventClaim.findFirst({ where: { activityId: entry.activityId, eventId: entry.eventId, participantId, registrationId: workingSnapshot.registration.id } });
            if (!ownClaim) await tx.participantEventClaim.create({ data: { activityId: entry.activityId, eventId: entry.eventId, participantId, registrationId: workingSnapshot.registration.id, eventEntryId: entry.id } });
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") fail("PARTICIPANT_EVENT_ALREADY_CLAIMED", "選手已被其他報名單位使用此賽事", 409, { participantId, eventId: entry.eventId });
            throw error;
          }
          currentIds.add(participantId); added++;
        }
        if (addedIds.length) {
          await tx.team.update({ where: { id: team.id, rowVersion: team.rowVersion }, data: { rowVersion: { increment: 1 } } });
          const entryVersion = entryVersions.get(entry.id);
          if (entryVersion === undefined) fail("STALE_VERSION", "賽事報名已被其他人更新，請重新整理");
          await tx.eventEntry.update({ where: { id: entry.id, rowVersion: entryVersion }, data: { rowVersion: { increment: 1 } } });
          entryVersions.set(entry.id, entryVersion + 1);
        }
      }
      if (added) await tx.registration.update({ where: { id: registrationId, rowVersion: expectedRegistrationVersion }, data: { rowVersion: { increment: 1 } } });
      await this.validation.validate(tx, registrationId).then((result) => { if (result.blockers.length) fail("ROSTER_OPTIMIZATION_BLOCKED", "套用後的報名未通過伺服器驗證", 422, result); });
      
      const finalSnapshot = await this.registrationSnapshot(tx, registrationId);
      return { registrationId, added, suggestion: this.formatRegistrationSuggestion(finalSnapshot) };
    }));
  }
}
