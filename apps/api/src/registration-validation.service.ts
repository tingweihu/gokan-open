import { Injectable } from "@nestjs/common";
import { Database, fail, type Tx } from "./core.js";
import { LeagueEligibilityService } from "./league.service.js";
import { validateTeamComposition } from "./team-rules.js";

@Injectable()
export class RegistrationValidationService {
  constructor(private readonly db: Database, private readonly leagueEligibility: LeagueEligibilityService) {}

  async validate(db: Database | Tx, registrationId: string, options: { officialFinal?: boolean; requireEventEntries?: boolean } = {}) {
    const registration = await db.registration.findUnique({ where: { id: registrationId }, include: { organization: true, league: { include: { members: true } }, eventEntries: { include: { event: true, teams: { include: { members: { where: { active: true }, include: { participant: true } } } } } }, eventClaims: true } });
    if (!registration) fail("NOT_FOUND", "找不到報名", 404);
    const blockers: { code: string; message: string; details?: unknown }[] = [];
    const warnings: { code: string; message: string }[] = [];
    const rosterValidity: { code: string; message: string; passed: boolean }[] = [];
    const unitValidity: { code: string; message: string; passed: boolean }[] = [];
    const eventValidity: { code: string; message: string; passed: boolean }[] = [];
    const entryValidity: { code: string; message: string; passed: boolean; eventId: string }[] = [];
    const teamValidity: { code: string; message: string; passed: boolean; teamId?: string }[] = [];
    const sourceEligibility: { code: string; message: string; passed: boolean; participantId?: string }[] = [];
    const claimValidity: { code: string; message: string; passed: boolean; participantId?: string }[] = [];
    const conflicts: { code: string; message: string; participantId: string; eventIds: string[] }[] = [];

    if (registration.organizationId) {
      const ok = Boolean(registration.organization?.active);
      unitValidity.push({ code: "REGISTRATION_CLUB_ACTIVE", message: ok ? "報名社團有效" : "報名社團已停用", passed: ok });
      if (!ok) blockers.push({ code: "REGISTRATION_UNIT_INVALID", message: "報名社團已停用" });
    } else if (registration.leagueId) {
      const league = await this.leagueEligibility.evaluate(db, registration.leagueId);
      unitValidity.push({ code: "LEAGUE_ELIGIBILITY", message: league.eligible ? "聯隊資格符合" : "聯隊資格尚未符合", passed: league.eligible });
      if (!league.eligible) blockers.push(...league.blockers.map((item) => ({ code: `LEAGUE_${item.code}`, message: item.message })));
    } else {
      unitValidity.push({ code: "REGISTRATION_UNIT_REQUIRED", message: "報名必須屬於社團或聯隊", passed: false });
      blockers.push({ code: "REGISTRATION_UNIT_INVALID", message: "報名必須屬於社團或聯隊" });
    }

    const participantEvents = new Map<string, string[]>();
    const schedule = await db.scheduleVersion.findFirst({ where: { activityId: registration.activityId, status: "PUBLISHED" }, include: { timeWindows: true } });
    const activeEntries = registration.eventEntries.filter((item) => item.active);
    if (options.requireEventEntries && !activeEntries.length) blockers.push({ code: "ROSTER_EMPTY", message: "請至少選擇 1 項賽事並完成隊伍名單" });
    for (const entry of activeEntries) {
      const effectiveTeams = entry.teams.filter((team) => team.admissionStatus !== "REJECTED");
      if (options.officialFinal && effectiveTeams.length === 0 && entry.teams.some((team) => team.admissionStatus === "REJECTED")) continue;
      const eventPublished = Boolean(schedule?.timeWindows.some((window) => window.eventId === entry.eventId));
      const eventOk = eventPublished && (registration.organizationId ? entry.event.allowClub : entry.event.allowLeague);
      eventValidity.push({ code: "EVENT_ENABLED", message: eventOk ? `${entry.event.name} 可報名` : `${entry.event.name} 目前未開放`, passed: eventOk });
      if (!eventOk) blockers.push({ code: "EVENT_INVALID", message: `${entry.event.name} 目前未開放報名` });
      const hasTeams = effectiveTeams.length > 0;
      entryValidity.push({ code: "EVENT_ENTRY_TEAMS", message: hasTeams ? `${entry.event.name} 已建立隊伍` : `${entry.event.name} 尚未建立隊伍`, passed: hasTeams, eventId: entry.eventId });
      if (!hasTeams) blockers.push({ code: "EVENT_ENTRY_INVALID", message: `${entry.event.name} 尚未建立隊伍` });
      for (const team of effectiveTeams) {
        const composition = validateTeamComposition(entry.event, team.members.map((member) => member.participant));
        const ok = composition.valid;
        teamValidity.push({ code: "TEAM_COMPOSITION", message: ok ? `第 ${team.ordinal} 隊規則符合` : (composition.blockers[0] ?? `第 ${team.ordinal} 隊規則不符合`), passed: ok, teamId: team.id });
        if (!ok) blockers.push({ code: "TEAM_COMPOSITION_INVALID", message: `${entry.event.name} 第 ${team.ordinal} 隊：${composition.blockers.join("；")}` });
        for (const member of team.members) {
          const participant = member.participant;
          const sourceOk = Boolean(participant.active) && (registration.organizationId ? participant.sourceOrganizationId === registration.organizationId : Boolean(registration.league?.members.some((item) => item.organizationId === participant.sourceOrganizationId && item.status === "CONFIRMED")));
          sourceEligibility.push({ code: "PARTICIPANT_SOURCE", message: sourceOk ? `${participant.name} 所屬社團符合` : `${participant.name} 不符合報名單位`, passed: sourceOk, participantId: participant.id });
          if (!sourceOk) blockers.push({ code: "PARTICIPANT_NOT_ELIGIBLE", message: `選手 ${participant.name} 不符合報名單位` });
          const events = participantEvents.get(participant.id) ?? [];
          events.push(entry.eventId);
          participantEvents.set(participant.id, events);
        }
      }
    }
    for (const [participantId, eventIds] of participantEvents) {
      const unique = [...new Set(eventIds)];
      const claims = registration.eventClaims.filter((claim) => claim.participantId === participantId);
      const claimOk = claims.length === unique.length;
      claimValidity.push({ code: "PARTICIPANT_EVENT_CLAIM", message: claimOk ? "參賽名額有效" : "參賽名額資料不一致", passed: claimOk, participantId });
      if (!claimOk) blockers.push({ code: "PARTICIPANT_EVENT_CLAIM_INVALID", message: "選手參賽名額資料不一致" });
      if (schedule && unique.length > 1) {
        for (let leftIndex = 0; leftIndex < unique.length; leftIndex++) for (let rightIndex = leftIndex + 1; rightIndex < unique.length; rightIndex++) {
          const left = schedule.timeWindows.filter((window) => window.eventId === unique[leftIndex]!);
          const right = schedule.timeWindows.filter((window) => window.eventId === unique[rightIndex]!);
          if (left.some((one) => right.some((two) => one.startAt < two.endAt && one.endAt > two.startAt))) conflicts.push({ code: "EVENT_TIME_CONFLICT", message: "選手參賽時間衝突", participantId, eventIds: [unique[leftIndex]!, unique[rightIndex]!] });
        }
      }
    }
    if (conflicts.length) blockers.push(...conflicts.map((conflict) => ({ code: conflict.code, message: conflict.message, details: conflict })));
    const rosterPassed = sourceEligibility.every((item) => item.passed);
    rosterValidity.push({ code: "ROSTER_VALID", message: rosterPassed ? "選手資料完整" : "選手資料有誤", passed: rosterPassed });
    if (!rosterPassed && !blockers.some((item) => item.code === "PARTICIPANT_NOT_ELIGIBLE")) blockers.push({ code: "ROSTER_INVALID", message: "選手資料有誤" });
    return { registrationId, eligible: blockers.length === 0, blockers, warnings, rosterValidity, registrationUnitValidity: unitValidity, leagueEligibility: registration.leagueId ? await this.leagueEligibility.evaluate(db, registration.leagueId) : null, eventValidity, eventEntryValidity: entryValidity, teamValidity, participantSourceEligibility: sourceEligibility, participantEventClaimValidity: claimValidity, participantTimeConflicts: conflicts };
  }
}
