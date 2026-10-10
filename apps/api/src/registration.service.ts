import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { Database, fail, lock, parse, uuid, reason, version, type RequestContext } from "./core.js";
import { IdentityService } from "./identity.service.js";
import { CompetitionService } from "./competition.service.js";
import { RegistrationValidationService } from "./registration-validation.service.js";
import { assertRegistrationSubmissionStage, operatingStage } from "./stage.js";

const mutation = z.object({ rowVersion: version, reason }).strict();

@Injectable()
export class RegistrationService {
  constructor(private readonly db: Database, private readonly identity: IdentityService, private readonly competition: CompetitionService, private readonly validation: RegistrationValidationService) {}
  private async actor(request: RequestContext) { return this.identity.authenticate(request); }
  async detail(request: RequestContext, registrationId: string) {
    parse(uuid, registrationId);
    const actor = await this.actor(request);
    const registration = await this.db.registration.findUnique({
      where: { id: registrationId },
      include: {
        organization: true,
        league: true,
        totalRosterAttachment: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } },
        eventEntries: {
          include: {
            event: true,
            teams: { include: { members: { where: { active: true }, include: { participant: true } } } },
          },
        },
      },
    });
    if (!registration) fail("NOT_FOUND", "找不到報名", 404);
    await this.competition.registrationScope(this.db, actor.user.id, registration);
    return { ...registration, validation: await this.validation.validate(this.db, registrationId) };
  }
  async rosterSubmit(request: RequestContext, registrationId: string, input: unknown) {
    parse(uuid, registrationId);
    const actor = await this.actor(request);
    const data = parse(mutation, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `registration:${registrationId}`);
      const registration = await tx.registration.findUnique({ where: { id: registrationId } });
      if (!registration) fail("NOT_FOUND", "找不到報名", 404);
      await this.competition.registrationScope(tx, actor.user.id, registration, false, Boolean(registration.leagueId));
      const activity = await tx.activity.findUnique({ where: { id: registration.activityId } });
      if (!activity) fail("NOT_FOUND", "找不到活動", 404);
      if (operatingStage(activity) !== "REGISTRATION") fail("ACTIVITY_STAGE_FORBIDS_ACTION", "目前不在報名開放期間，無法送出選手名單", 409);
      if (!["DRAFT", "RETURNED"].includes(registration.status)) fail("REGISTRATION_LOCKED", "目前狀態不可送出選手名單", 409);
      if (registration.rowVersion !== data.rowVersion) fail("STALE_VERSION", "報名資料已更新，請重新整理");
      const result = await this.validation.validate(tx, registrationId, { requireEventEntries: true });
      if (result.blockers.length) fail("ROSTER_SUBMISSION_BLOCKED", "選手名單尚有未完成項目", 422, result);
      const updated = await tx.registration.update({ where: { id: registrationId, rowVersion: data.rowVersion }, data: { submittedAt: new Date(), rowVersion: { increment: 1 } } });
      
      return { ...updated, validation: result };
    });
  }
  async submit(request: RequestContext, registrationId: string, input: unknown) {
    const actor = await this.actor(request);
    const data = parse(mutation, input);
    return this.db.$transaction(async (tx) => {
      const registration = await tx.registration.findUnique({ where: { id: registrationId } });
      if (!registration) fail("NOT_FOUND", "找不到報名", 404);
      await this.competition.registrationScope(tx, actor.user.id, registration, false, Boolean(registration.leagueId));
      const activity = await tx.activity.findUnique({ where: { id: registration.activityId } });
      if (!activity) fail("NOT_FOUND", "找不到活動", 404);
      assertRegistrationSubmissionStage(activity, registration);
      if (!["DRAFT", "RETURNED"].includes(registration.status)) fail("REGISTRATION_LOCKED", "目前狀態不可送出", 409);
      if (registration.rowVersion !== data.rowVersion) fail("STALE_VERSION", "報名資料已更新，請重新整理");
      const result = await this.validation.validate(tx, registrationId);
      if (result.blockers.length) fail("SUBMISSION_BLOCKED", "報名尚有未完成項目", 422, result);
      if (!registration.leagueId && !registration.totalRosterAttachmentId)
        fail("TOTAL_ROSTER_REQUIRED", "請先上傳總參賽名單（學校核章）PDF", 422);
      const updated = await tx.registration.update({
        where: { id: registrationId, rowVersion: data.rowVersion },
        data: { status: "SUBMITTED", submittedAt: new Date(), returnedAt: null, returnReason: null, rowVersion: { increment: 1 } },
      });
      
      return { ...updated, validation: result };
    });
  }
  async reviewList(request: RequestContext, activityId: string) { const actor = await this.actor(request); await this.identity.staff(this.db, actor.user.id, activityId, ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"]); return this.db.registration.findMany({ where: { activityId, status: "SUBMITTED" }, include: { organization: true, league: true, totalRosterAttachment: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } } }, orderBy: { submittedAt: "asc" } }); }
  private async reviewer(request: RequestContext, activityId: string) { const actor = await this.actor(request); await this.identity.staff(this.db, actor.user.id, activityId, ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"]); return actor.user.id; }
  async returnRegistration(request: RequestContext, registrationId: string, input: unknown) {
    const data = parse(mutation, input);
    return this.db.$transaction(async (tx) => {
      const registration = await tx.registration.findUnique({ where: { id: registrationId } });
      if (!registration) fail("NOT_FOUND", "找不到報名", 404);
      const actor = await this.reviewer(request, registration.activityId);
      await lock(tx, "registration:" + registrationId);
      if (registration.status !== "SUBMITTED") fail("REGISTRATION_TRANSITION_INVALID", "只有審核中的報名可以退回", 409);
      if (registration.rowVersion !== data.rowVersion) fail("STALE_VERSION", "報名資料已更新，請重新整理");
      const updated = await tx.registration.update({ where: { id: registrationId, rowVersion: data.rowVersion }, data: { status: "RETURNED", returnedAt: new Date(), returnReason: data.reason, rowVersion: { increment: 1 } } });
      
      return updated;
    });
  }
  async confirm(request: RequestContext, registrationId: string, input: unknown) {
    const data = parse(mutation, input);
    return this.db.$transaction(async (tx) => {
      const registration = await tx.registration.findUnique({ where: { id: registrationId } });
      if (!registration) fail("NOT_FOUND", "找不到報名", 404);
      const actor = await this.reviewer(request, registration.activityId);
      await lock(tx, "registration:" + registrationId);
      if (registration.status !== "SUBMITTED") fail("REGISTRATION_TRANSITION_INVALID", "只有審核中的報名可以確認", 409);
      if (registration.rowVersion !== data.rowVersion) fail("STALE_VERSION", "報名資料已更新，請重新整理");
      const result = await this.validation.validate(tx, registrationId);
      if (result.blockers.length) fail("CONFIRMATION_BLOCKED", "目前報名驗證仍有阻擋項目", 422, result);
      const updated = await tx.registration.update({ where: { id: registrationId, rowVersion: data.rowVersion }, data: { status: "CONFIRMED", confirmedAt: new Date(), rowVersion: { increment: 1 } } });
      
      return { ...updated, validation: result };
    });
  }
}
