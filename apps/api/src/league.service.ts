import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { Database, fail, lock, parse, uuid, label, reason, version, type RequestContext, type Tx } from "./core.js";
import { IdentityService } from "./identity.service.js";
import { assertPreRegistrationEdit } from "./stage.js";

const ruleInput = z.object({
  minimumMemberClubs: z.number().int().min(2),
  maximumMemberClubs: z.number().int().min(2).nullable(),
  minimumParticipants: z.number().int().min(0).nullable(),
  maximumParticipants: z.number().int().min(0).nullable(),
  lowParticipantQualificationEnabled: z.boolean().default(true),
  lowParticipantThreshold: z.number().int().min(0).nullable().default(15),
  genderImbalanceQualificationEnabled: z.boolean().default(true),
  minorityGenderRatioPercent: z.number().int().min(0).max(50).nullable().default(25),
  qualificationMode: z.enum(["ANY", "ALL"]).default("ANY"),
  singleGenderExceptionEnabled: z.boolean().default(true),
  singleGenderExceptionMaximumMemberClubs: z.number().int().min(2).nullable().default(null),
  singleGenderExceptionMaximumParticipants: z.number().int().min(0).nullable().default(35),
  rowVersion: version,
  reason,
}).strict().refine((v) => v.maximumMemberClubs === null || v.maximumMemberClubs >= v.minimumMemberClubs, "社團上限不可小於下限")
  .refine((v) => v.minimumParticipants === null || v.maximumParticipants === null || v.maximumParticipants >= v.minimumParticipants, "選手上限不可小於下限");
const createInput = z.object({ name: label, ownerOrganizationId: uuid, reason }).strict();
const memberInput = z.object({ organizationId: uuid, rowVersion: version, reason }).strict();
const leagueUpdateInput = z.object({ name: label, rowVersion: version, reason }).strict();
const leagueMutationInput = z.object({ rowVersion: version, reason }).strict();

type DbLike = Database | Tx;
const DEFAULT_LEAGUE_RULE = {
  minimumMemberClubs: 2,
  maximumMemberClubs: 4,
  minimumParticipants: null,
  maximumParticipants: 28,
  lowParticipantQualificationEnabled: true,
  lowParticipantThreshold: 15,
  genderImbalanceQualificationEnabled: true,
  minorityGenderRatioPercent: 25,
  qualificationMode: "ANY" as const,
  singleGenderExceptionEnabled: true,
  singleGenderExceptionMaximumMemberClubs: null,
  singleGenderExceptionMaximumParticipants: 35,
  rowVersion: 1,
};

@Injectable()
export class LeagueEligibilityService {
  constructor(private readonly db: Database) {}

  async clubQualification(db: DbLike, activityId: string, organizationId: string) {
    const rule = await db.leagueRule.findUnique({ where: { activityId } });
    const effective = rule ?? DEFAULT_LEAGUE_RULE;
    const roster = await db.participant.findMany({ where: { activityId, sourceOrganizationId: organizationId, active: true }, select: { gender: true } });
    const male = roster.filter((p) => p.gender === "MALE").length;
    const female = roster.length - male;
    const minorityGenderRatio = roster.length === 0 ? 0 : Math.min(male, female) / roster.length;
    const checks = [] as { code: string; type: string; passed: boolean; message: string; value: number; required: number | null }[];
    if (effective.lowParticipantQualificationEnabled && effective.lowParticipantThreshold !== null) checks.push({ code: "PARTICIPANT_COUNT", type: "PARTICIPANT_COUNT", passed: roster.length <= effective.lowParticipantThreshold, message: `本屆參賽選手 ${roster.length} 人，${roster.length <= effective.lowParticipantThreshold ? "符合" : "未符合"} ${effective.lowParticipantThreshold} 人以下條件`, value: roster.length, required: effective.lowParticipantThreshold });
    if (effective.genderImbalanceQualificationEnabled && effective.minorityGenderRatioPercent !== null) checks.push({ code: "GENDER_RATIO", type: "GENDER_RATIO", passed: roster.length > 0 && minorityGenderRatio * 100 <= effective.minorityGenderRatioPercent, message: `較少性別比例 ${(minorityGenderRatio * 100).toFixed(1)}%，${roster.length > 0 && minorityGenderRatio * 100 <= effective.minorityGenderRatioPercent ? "符合" : "未符合"} ${effective.minorityGenderRatioPercent}% 以下條件`, value: minorityGenderRatio, required: effective.minorityGenderRatioPercent / 100 });
    const qualified = roster.length > 0 && checks.length > 0 && (effective.qualificationMode === "ALL" ? checks.every((check) => check.passed) : checks.some((check) => check.passed));
    return { eligible: qualified, participantCount: roster.length, genderCounts: { male, female }, minorityGenderRatio, checks, blockers: qualified ? [] : roster.length === 0 ? [{ code: "NO_ACTIVE_PARTICIPANTS", message: "請先建立至少 1 位有效選手" }] : [{ code: "CLUB_NOT_QUALIFIED", message: "本屆參賽資料尚未符合聯隊資格" }] };
  }

  async evaluate(db: DbLike, leagueId: string) {
    const league = await db.league.findUnique({ where: { id: leagueId }, include: { members: { include: { organization: true } } } });
    if (!league) fail("NOT_FOUND", "找不到聯隊", 404);
    const rule = await db.leagueRule.findUnique({ where: { activityId: league.activityId } });
    const effective = rule ?? DEFAULT_LEAGUE_RULE;
    const confirmed = league.members.filter((m) => m.status === "CONFIRMED");
    const activeConfirmed = confirmed.filter((m) => m.organization.active);
    const activeMembers = league.members.filter((m) => m.organization.active);
    const qualifications = await Promise.all(activeConfirmed.map((member) => this.clubQualification(db, league.activityId, member.organizationId)));
    const singleGenderClubs = activeConfirmed.filter((_, index) => { const qualification = qualifications[index]; return qualification ? qualification.genderCounts.male === 0 || qualification.genderCounts.female === 0 : false; }).map((member) => member.organizationId);
    const exception = effective.singleGenderExceptionEnabled && singleGenderClubs.length > 0;
    const maximumClubs = exception ? effective.singleGenderExceptionMaximumMemberClubs : effective.maximumMemberClubs;
    const maximumParticipants = exception ? effective.singleGenderExceptionMaximumParticipants : effective.maximumParticipants;
    const ids = activeConfirmed.map((m) => m.organizationId);
    const roster = await db.participant.findMany({ where: { activityId: league.activityId, active: true, sourceOrganizationId: { in: ids.length ? ids : ["00000000-0000-0000-0000-000000000000"] } }, select: { id: true } });
    const selected = await db.teamMember.findMany({ where: { active: true, eventEntry: { registration: { leagueId: league.id } } }, select: { participantId: true } });
    const actualParticipantCount = new Set(selected.map((item) => item.participantId)).size;
    const participantCount = roster.length;
    const participatingParticipantCount = actualParticipantCount || participantCount;
    const minimumClubs = Math.max(2, effective.minimumMemberClubs);
    const checks = [
      { code: "MEMBER_COUNT", label: `至少需要 ${minimumClubs} 個已確認社團`, passed: activeConfirmed.length >= minimumClubs, value: activeConfirmed.length, required: minimumClubs },
      { code: "CONFIRMATIONS", label: "所有成員社團都已確認", passed: activeMembers.length === confirmed.length, value: confirmed.length, required: activeMembers.length },
      ...(maximumClubs === null ? [] : [{ code: "MAX_MEMBER_COUNT", label: `最多 ${maximumClubs} 個社團`, passed: activeConfirmed.length <= maximumClubs, value: activeConfirmed.length, required: maximumClubs }]),
      { code: "CLUB_QUALIFICATION", label: "所有確認社團都符合本屆聯隊資格", passed: qualifications.every((item) => item.eligible), value: qualifications.filter((item) => item.eligible).length, required: qualifications.length },
      ...(effective.minimumParticipants === null ? [] : [{ code: "MIN_PARTICIPANTS", label: `至少需要 ${effective.minimumParticipants} 位有效選手`, passed: participatingParticipantCount >= effective.minimumParticipants, value: participatingParticipantCount, required: effective.minimumParticipants }]),
      ...(maximumParticipants === null ? [] : [{ code: "MAX_PARTICIPANTS", label: `最多 ${maximumParticipants} 位實際參賽選手`, passed: participatingParticipantCount <= maximumParticipants, value: participatingParticipantCount, required: maximumParticipants }]),
    ];
    const blockers = checks.filter((c) => !c.passed).map((c) => ({ code: c.code, message: c.label }));
    return { eligible: blockers.length === 0, checks, blockers, participantCount, actualParticipantCount, confirmedMemberCount: confirmed.length, maximumMemberClubs: maximumClubs, maximumParticipants, singleGenderMemberClubs: singleGenderClubs, clubQualifications: qualifications };
  }

  async participants(db: DbLike, leagueId: string) {
    const league = await db.league.findUnique({ where: { id: leagueId }, include: { members: true } });
    if (!league) fail("NOT_FOUND", "找不到聯隊", 404);
    const ids = league.members.filter((m) => m.status === "CONFIRMED").map((m) => m.organizationId);
    return db.participant.findMany({ where: { activityId: league.activityId, active: true, sourceOrganizationId: { in: ids.length ? ids : ["00000000-0000-0000-0000-000000000000"] } }, include: { sourceOrganization: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  }
}

@Injectable()
export class LeagueService {
  constructor(private readonly db: Database, private readonly identity: IdentityService, private readonly eligibility: LeagueEligibilityService) {}

  private async actor(request: RequestContext) { return this.identity.authenticate(request); }
  private async staffOrMember(request: RequestContext, activityId: string, leagueId?: string) {
    const actor = await this.actor(request);
    const staff = await this.db.activityStaff.findFirst({ where: { userId: actor.user.id, activityId, revokedAt: null, role: { in: ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"] } } });
    if (staff) return { actor: actor.user.id, staff: staff.role };
    const member = await this.db.organizationMembership.findFirst({ where: { userId: actor.user.id, revokedAt: null, organization: { activityId, active: true }, ...(leagueId ? { organization: { activityId, active: true, leagueMemberships: { some: { leagueId } } } } : {}) } });
    if (!member) fail("FORBIDDEN", "您沒有此聯隊的權限", 403);
    return { actor: actor.user.id, staff: null, organizationId: member.organizationId };
  }
  private async owner(tx: Tx, actorId: string, league: { activityId: string; ownerOrganizationId: string }) {
    const admin = await tx.activityStaff.findFirst({ where: { userId: actorId, activityId: league.activityId, revokedAt: null, role: "SYSTEM_ADMIN" } });
    if (admin) return;
    await this.identity.club(tx, actorId, league.ownerOrganizationId);
  }
  private async syncStatus(tx: Tx, leagueId: string) {
    const result = await this.eligibility.evaluate(tx, leagueId);
    const status = result.eligible ? "ACTIVE" : "PENDING_CONFIRMATION";
    await tx.league.updateMany({ where: { id: leagueId, status: { not: "DISSOLVED" } }, data: { status } });
    return result;
  }
  async rule(request: RequestContext, activityId: string) {
    await this.staffOrMember(request, activityId);
    const rule = await this.db.leagueRule.findUnique({ where: { activityId } });
    return rule ?? { activityId, id: null, ...DEFAULT_LEAGUE_RULE };
  }
  async qualification(request: RequestContext, activityId: string, organizationId: string) {
    parse(uuid, activityId); parse(uuid, organizationId);
    const actor = await this.actor(request);
    const organization = await this.db.organization.findFirst({ where: { id: organizationId, activityId, active: true } });
    if (!organization) fail("NOT_FOUND", "找不到有效社團", 404);
    const admin = await this.db.activityStaff.findFirst({ where: { userId: actor.user.id, activityId, revokedAt: null, role: "SYSTEM_ADMIN" } });
    if (!admin) await this.identity.club(this.db, actor.user.id, organizationId);
    return this.eligibility.clubQualification(this.db, activityId, organizationId);
  }
  async updateRule(request: RequestContext, activityId: string, input: unknown) {
    const actor = await this.actor(request); await this.identity.staff(this.db, actor.user.id, activityId, ["SYSTEM_ADMIN"]);
    const parsed = parse(ruleInput, input); const legacyRulePayload = !Object.prototype.hasOwnProperty.call(input as object, "singleGenderExceptionEnabled"); const { rowVersion, reason: why, ...parsedData } = parsed; const data = { ...parsedData, ...(legacyRulePayload ? { singleGenderExceptionEnabled: false } : {}) };
    return this.db.$transaction(async (tx) => { await lock(tx, `activity:${activityId}`); const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { registrationOpensAt: true } }); if (!activity) fail("NOT_FOUND", "找不到活動", 404); assertPreRegistrationEdit(activity, "報名已開始，本年度聯隊規則已鎖定。"); const existing = await tx.leagueRule.findUnique({ where: { activityId } }); if (!existing) { if (rowVersion !== 1) fail("STALE_VERSION", "資料版本已過期"); const created = await tx.leagueRule.create({ data: { activityId, ...data } });  return created; } const before = { minimumMemberClubs: existing.minimumMemberClubs, maximumMemberClubs: existing.maximumMemberClubs, minimumParticipants: existing.minimumParticipants, maximumParticipants: existing.maximumParticipants, lowParticipantQualificationEnabled: existing.lowParticipantQualificationEnabled, lowParticipantThreshold: existing.lowParticipantThreshold, genderImbalanceQualificationEnabled: existing.genderImbalanceQualificationEnabled, minorityGenderRatioPercent: existing.minorityGenderRatioPercent, qualificationMode: existing.qualificationMode, singleGenderExceptionEnabled: existing.singleGenderExceptionEnabled, singleGenderExceptionMaximumMemberClubs: existing.singleGenderExceptionMaximumMemberClubs, singleGenderExceptionMaximumParticipants: existing.singleGenderExceptionMaximumParticipants }; const updated = await tx.leagueRule.update({ where: { activityId, rowVersion }, data: { ...data, rowVersion: { increment: 1 } } });  return updated; });
  }
  async list(request: RequestContext, activityId: string) {
    const access = await this.staffOrMember(request, activityId);
    const leagues = await this.db.league.findMany({ where: { activityId, ...(access.staff ? {} : { members: { some: { organizationId: access.organizationId } } }) }, include: { owner: true, members: { include: { organization: true } } }, orderBy: { name: "asc" } });
    return Promise.all(leagues.map(async (league) => ({ ...league, eligibility: await this.eligibility.evaluate(this.db, league.id) })));
  }
  async get(request: RequestContext, leagueId: string) {
    const league = await this.db.league.findUnique({ where: { id: leagueId }, include: { owner: true, members: { include: { organization: true } } } });
    if (!league) fail("NOT_FOUND", "找不到聯隊", 404);
    await this.staffOrMember(request, league.activityId, league.id);
    return { ...league, eligibility: await this.eligibility.evaluate(this.db, league.id), participants: await this.eligibility.participants(this.db, league.id) };
  }
  async create(request: RequestContext, activityId: string, input: unknown) {
    const actor = await this.actor(request);
    const data = parse(createInput, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      const org = await tx.organization.findFirst({ where: { id: data.ownerOrganizationId, activityId, active: true } });
      if (!org) fail("NOT_FOUND", "找不到有效社團", 404);
      await this.identity.club(tx, actor.user.id, org.id);
      const pending = await tx.league.findFirst({ where: { activityId, ownerOrganizationId: org.id, status: { not: "DISSOLVED" }, members: { some: { status: "PENDING" } } }, select: { id: true } });
      if (pending) fail("LEAGUE_INVITATION_PENDING", "此負責社團已有一個待處理的聯隊邀請，請等待受邀社團回覆後再發起下一個邀請。", 409);
      const existing = await tx.league.findFirst({ where: { activityId, status: { not: "DISSOLVED" }, members: { some: { organizationId: org.id } } }, select: { id: true } });
      if (existing) fail("LEAGUE_ALREADY_EXISTS", "此社團已送出或加入聯隊申請，每個社團只能有一份聯隊申請。", 409);
      const qualification = await this.eligibility.clubQualification(tx, activityId, org.id);
      if (qualification.participantCount === 0) {
        fail("LEAGUE_CLUB_NOT_QUALIFIED", "尚未建立有效選手名單，無法發起聯隊。", 422, { blockers: [{ code: "NO_ACTIVE_PARTICIPANTS", message: "請先建立至少 1 位有效選手" }], qualification });
      }
      if (!qualification.eligible) fail("LEAGUE_CLUB_NOT_QUALIFIED", "本社團目前尚未符合聯隊資格，無法發起聯隊。", 422, { blockers: qualification.blockers });
      const league = await tx.league.create({ data: { activityId, name: data.name, ownerOrganizationId: org.id, members: { create: { activityId, organizationId: org.id, status: "CONFIRMED", confirmedByUserId: actor.user.id, confirmedAt: new Date() } } }, include: { owner: true, members: { include: { organization: true } } } });
      
      return { ...league, eligibility: await this.syncStatus(tx, league.id) };
    });
  }

  async update(request: RequestContext, leagueId: string, input: unknown) {
    parse(uuid, leagueId);
    const actor = await this.actor(request);
    const data = parse(leagueUpdateInput, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `league:${leagueId}`);
      const league = await tx.league.findUnique({ where: { id: leagueId }, include: { owner: true, members: { include: { organization: true } } } });
      if (!league) fail("NOT_FOUND", "找不到聯隊", 404);
      await this.owner(tx, actor.user.id, league);
      if (league.status === "DISSOLVED") fail("LEAGUE_LOCKED", "已撤銷的聯隊不可編輯。", 409);
      const registration = await tx.registration.findFirst({ where: { leagueId }, select: { id: true } });
      if (registration) fail("LEAGUE_LOCKED", "聯隊已有報名資料，無法再編輯。", 409);
      const updated = await tx.league.update({ where: { id: leagueId, rowVersion: data.rowVersion }, data: { name: data.name, rowVersion: { increment: 1 } }, include: { owner: true, members: { include: { organization: true } } } });
      
      return { ...updated, eligibility: await this.syncStatus(tx, leagueId) };
    });
  }

  async withdraw(request: RequestContext, leagueId: string, input: unknown) {
    parse(uuid, leagueId);
    const actor = await this.actor(request);
    const data = parse(leagueMutationInput, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `league:${leagueId}`);
      const league = await tx.league.findUnique({ where: { id: leagueId }, include: { owner: true, members: { include: { organization: true } } } });
      if (!league) fail("NOT_FOUND", "找不到聯隊", 404);
      await this.owner(tx, actor.user.id, league);
      if (league.status === "DISSOLVED") return { ...league, eligibility: await this.eligibility.evaluate(tx, leagueId) };
      const registration = await tx.registration.findFirst({ where: { leagueId }, select: { id: true } });
      if (registration) fail("LEAGUE_LOCKED", "聯隊已有報名資料，無法撤銷。", 409);
      const updated = await tx.league.update({ where: { id: leagueId, rowVersion: data.rowVersion }, data: { status: "DISSOLVED", rowVersion: { increment: 1 } }, include: { owner: true, members: { include: { organization: true } } } });
      
      return { ...updated, eligibility: await this.eligibility.evaluate(tx, leagueId) };
    });
  }
  async addMember(request: RequestContext, leagueId: string, input: unknown) {
    const data = parse(memberInput, input); const actor = await this.actor(request);
    return this.db.$transaction(async (tx) => { await lock(tx, `league:${leagueId}`); const league = await tx.league.findUnique({ where: { id: leagueId }, include: { members: true } }); if (!league) fail("NOT_FOUND", "找不到聯隊", 404); await lock(tx, `activity:${league.activityId}`); await this.owner(tx, actor.user.id, league); if (league.status === "DISSOLVED") fail("LEAGUE_LOCKED", "已撤銷的聯隊不可再邀請社團。", 409); if (await tx.registration.findFirst({ where: { leagueId }, select: { id: true } })) fail("LEAGUE_LOCKED", "聯隊已有報名資料，無法再邀請社團。", 409); const org = await tx.organization.findFirst({ where: { id: data.organizationId, activityId: league.activityId, active: true } }); if (!org) fail("NOT_FOUND", "找不到同年度有效社團", 404); if (org.id === league.ownerOrganizationId) fail("LEAGUE_CANNOT_INVITE_OWNER", "負責社團已是聯隊成員，不能再次邀請自己。", 409); if (league.members.some((m) => m.organizationId === org.id)) fail("DUPLICATE_RECORD", "此社團已在聯隊中", 409); const otherLeague = await tx.league.findFirst({ where: { activityId: league.activityId, status: { not: "DISSOLVED" }, id: { not: league.id }, members: { some: { organizationId: org.id } } }, select: { id: true } }); if (otherLeague) fail("LEAGUE_ALREADY_EXISTS", "此社團已送出或加入其他聯隊申請，每個社團只能有一份聯隊申請。", 409); await tx.league.update({ where: { id: league.id, rowVersion: data.rowVersion }, data: { rowVersion: { increment: 1 }, members: { create: { activityId: league.activityId, organizationId: org.id, status: "PENDING" } } } });  return this.getByTx(tx, league.id); });
  }
  async confirm(request: RequestContext, leagueId: string, memberId: string, input: unknown) {
    const data = z.object({ rowVersion: version, reason }).strict().parse(input); parse(uuid, memberId); const actor = await this.actor(request);
    return this.db.$transaction(async (tx) => { await lock(tx, `league:${leagueId}`); const league = await tx.league.findUnique({ where: { id: leagueId }, include: { members: true } }); if (!league) fail("NOT_FOUND", "找不到聯隊", 404); await lock(tx, `activity:${league.activityId}`); if (league.status === "DISSOLVED") fail("LEAGUE_LOCKED", "已撤銷的聯隊不可再確認加入。", 409); const member = league.members.find((m) => m.id === memberId); if (!member) fail("NOT_FOUND", "找不到聯隊成員", 404); const otherLeague = await tx.league.findFirst({ where: { activityId: league.activityId, status: { not: "DISSOLVED" }, id: { not: league.id }, members: { some: { organizationId: member.organizationId } } }, select: { id: true } }); if (otherLeague) fail("LEAGUE_ALREADY_EXISTS", "此社團已送出或加入其他聯隊申請，每個社團只能有一份聯隊申請。", 409); const admin = await tx.activityStaff.findFirst({ where: { userId: actor.user.id, activityId: league.activityId, revokedAt: null, role: "SYSTEM_ADMIN" } }); if (!admin) await this.identity.club(tx, actor.user.id, member.organizationId); if (member.status === "CONFIRMED") return this.getByTx(tx, league.id); await tx.league.update({ where: { id: league.id, rowVersion: data.rowVersion }, data: { rowVersion: { increment: 1 }, members: { update: { where: { id: member.id }, data: { status: "CONFIRMED", confirmedByUserId: actor.user.id, confirmedAt: new Date() } } } } });  return this.getByTx(tx, league.id); });
  }
  private async getByTx(tx: Tx, leagueId: string) { const league = await tx.league.findUnique({ where: { id: leagueId }, include: { owner: true, members: { include: { organization: true } } } }); if (!league) fail("NOT_FOUND", "找不到聯隊", 404); return { ...league, eligibility: await this.syncStatus(tx, league.id), participants: await this.eligibility.participants(tx, league.id) }; }
  async participants(request: RequestContext, leagueId: string) { const league = await this.db.league.findUnique({ where: { id: leagueId } }); if (!league) fail("NOT_FOUND", "找不到聯隊", 404); await this.staffOrMember(request, league.activityId, league.id); return this.eligibility.participants(this.db, leagueId); }
}
