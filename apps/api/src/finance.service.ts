import { Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  Database,
  fail,
  lock,
  parse,
  uuid,
  version,
  reason,
  type RequestContext,
} from "./core.js";
import { IdentityService } from "./identity.service.js";
import { CompetitionService } from "./competition.service.js";
import { RegistrationValidationService } from "./registration-validation.service.js";
import { putProof, readProof, removeProof, validateProof, validateTotalRoster } from "./proof-storage.js";
import { assertPreRegistrationEdit, assertRegistrationSubmissionStage } from "./stage.js";
import { FinanceCalculationService } from "./finance-calculation.service.js";

const money = z.number().int().min(0).max(100_000_000);
const positiveMoney = z.number().int().positive().max(100_000_000);
const instant = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const feeInput = z.object({ registrationBaseFee: money, participantFee: money, defaultTeamEntryFee: money, rowVersion: version, reason }).strict();
const overrideInput = z.object({ eventId: uuid, teamEntryFee: money, reason }).strict();
const feeConfigurationInput = z.object({ registrationBaseFee: money, participantFee: money, defaultTeamEntryFee: money, overrides: z.array(z.object({ eventId: uuid, teamEntryFee: money }).strict()).max(500), rowVersion: version, reason }).strict();
const remittanceInput = z.object({ remittanceInstructions: z.string().trim().max(4000).nullable(), rowVersion: version, reason }).strict();
const paymentInput = z.object({ amount: positiveMoney, paidAt: instant, payerName: z.string().trim().max(120).nullable().optional(), bankAccountLastFive: z.string().trim().regex(/^\d{5}$/).nullable().optional(), reference: z.string().trim().max(200).nullable().optional(), proofAttachmentId: uuid.nullable().optional() }).strict();
const documentInput = z.object({ filename: z.string().min(1).max(240), mime: z.string().trim().max(120), base64: z.string().min(1).max(Math.ceil((10 * 1024 * 1024 * 4) / 3) + 16) }).strict();
const paymentReviewInput = z.object({ rowVersion: version, reason: z.string().trim().max(1000).optional().default(""), receivedAmount: z.number().int().min(0).optional() }).strict();
const refundInput = z.object({ amount: positiveMoney, reason }).strict();
const refundMutation = z.object({ rowVersion: version, reason: z.string().trim().max(1000).optional().default("") }).strict();

@Injectable()
export class ParticipationEligibilityService {
  constructor(private readonly db: Database, private readonly finance: FinanceCalculationService, private readonly validation: RegistrationValidationService) {}
  async evaluate(registrationId: string) {
    const registration = await this.db.registration.findUnique({ where: { id: registrationId }, select: { id: true, status: true } });
    if (!registration) fail("NOT_FOUND", "找不到報名", 404);
    const calculation = await this.finance.calculate(this.db, registrationId);
    const validation = await this.validation.validate(this.db, registrationId);
    const eligible = registration.status === "CONFIRMED" && calculation.scheduleConfigured && calculation.financiallyEligible && validation.blockers.length === 0;
    return { registrationId, registrationConfirmed: registration.status === "CONFIRMED", financiallyEligible: calculation.financiallyEligible, scheduleConfigured: calculation.scheduleConfigured, validationPassed: validation.blockers.length === 0, eligible, amountDue: calculation.amountDue, netPaid: calculation.netPaid, balanceDue: calculation.balanceDue };
  }
}

@Injectable()
export class FinanceService {
  constructor(private readonly db: Database, private readonly identity: IdentityService, private readonly competition: CompetitionService, private readonly finance: FinanceCalculationService, private readonly eligibility: ParticipationEligibilityService) {}

  private async actor(request: RequestContext) { return this.identity.authenticate(request); }
  private async activityStaff(request: RequestContext, activityId: string, roles: ("SYSTEM_ADMIN" | "REGISTRATION_FINANCE")[]) {
    const actor = await this.actor(request);
    await this.identity.staff(this.db, actor.user.id, activityId, roles);
    return actor.user.id;
  }

  async getFeeSchedule(request: RequestContext, activityId: string) {
    const actor = await this.actor(request);
    const activity = await this.db.activity.findUnique({ where: { id: activityId } });
    if (!activity) fail("NOT_FOUND", "找不到活動", 404);
    const staff = await this.db.activityStaff.findFirst({ where: { userId: actor.user.id, activityId, revokedAt: null, role: { in: ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"] } } });
    const member = await this.db.organizationMembership.findFirst({ where: { userId: actor.user.id, revokedAt: null, organization: { activityId, active: true } } });
    if (!staff && !member) fail("FORBIDDEN", "您沒有此活動的權限", 403);
    const schedule = await this.db.feeSchedule.findUnique({ where: { activityId }, include: { feeOverrides: true } });
    // Nest serializes a top-level null as an empty 200 response. Return the
    // editable annual defaults instead so the fee-settings screen always has
    // a JSON document before the first save.
    return schedule ? { ...schedule, remittanceInstructions: activity.remittanceInstructions, activityRowVersion: activity.rowVersion } : {
      activityId,
      registrationBaseFee: 0,
      participantFee: 0,
      defaultTeamEntryFee: 0,
      rowVersion: 1,
      feeOverrides: [],
      remittanceInstructions: activity.remittanceInstructions,
      activityRowVersion: activity.rowVersion,
    };
  }

  async updateRemittanceInstructions(request: RequestContext, activityId: string, input: unknown) {
    const actor = await this.activityStaff(request, activityId, ["SYSTEM_ADMIN"]);
    const data = parse(remittanceInput, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      const current = await tx.activity.findUnique({ where: { id: activityId } });
      if (!current) fail("NOT_FOUND", "找不到活動", 404);
      if (current.rowVersion !== data.rowVersion) fail("STALE_VERSION", "年度設定已被其他人更新，請重新整理");
      const updated = await tx.activity.update({ where: { id: activityId, rowVersion: data.rowVersion }, data: { remittanceInstructions: data.remittanceInstructions || null, rowVersion: { increment: 1 } } });
      
      return { activityId, remittanceInstructions: updated.remittanceInstructions, rowVersion: updated.rowVersion };
    });
  }

  async updateFeeSchedule(request: RequestContext, activityId: string, input: unknown) {
    const actor = await this.activityStaff(request, activityId, ["SYSTEM_ADMIN"]);
    const data = parse(feeInput, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { registrationOpensAt: true } });
      if (!activity) fail("NOT_FOUND", "找不到活動", 404);
      assertPreRegistrationEdit(activity, "報名已開始，本年度報名費設定已鎖定。");
      const current = await tx.feeSchedule.findUnique({ where: { activityId } });
      if (!current) {
        if (data.rowVersion !== 1) fail("STALE_VERSION", "費用設定版本已過期");
        const created = await tx.feeSchedule.create({ data: { activityId, registrationBaseFee: data.registrationBaseFee, participantFee: data.participantFee, defaultTeamEntryFee: data.defaultTeamEntryFee, updatedById: actor } });
        
        return created;
      }
      if (current.rowVersion !== data.rowVersion) fail("STALE_VERSION", "費用設定已被其他人更新，請重新整理");
      const updated = await tx.feeSchedule.update({ where: { activityId, rowVersion: data.rowVersion }, data: { registrationBaseFee: data.registrationBaseFee, participantFee: data.participantFee, defaultTeamEntryFee: data.defaultTeamEntryFee, updatedById: actor, rowVersion: { increment: 1 } } });
      
      return updated;
    });
  }

  async updateFeeConfiguration(request: RequestContext, activityId: string, input: unknown) {
    const actor = await this.activityStaff(request, activityId, ["SYSTEM_ADMIN"]);
    const data = parse(feeConfigurationInput, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { registrationOpensAt: true } });
      if (!activity) fail("NOT_FOUND", "找不到活動", 404);
      assertPreRegistrationEdit(activity, "報名已開始，本年度報名費設定已鎖定。");
      const current = await tx.feeSchedule.findUnique({ where: { activityId } });
      if (current && current.rowVersion !== data.rowVersion) fail("STALE_VERSION", "費用設定已被其他人更新，請重新整理");
      if (!current && data.rowVersion !== 1) fail("STALE_VERSION", "費用設定版本已過期");
      const ids = data.overrides.map((item) => item.eventId);
      if (new Set(ids).size !== ids.length) fail("DUPLICATE_RECORD", "賽事項目費用不可重複設定", 409);
      const events = ids.length ? await tx.competitionEvent.findMany({ where: { activityId, id: { in: ids } }, select: { id: true } }) : [];
      if (events.length !== ids.length) fail("NOT_FOUND", "找不到同一活動的賽事項目", 404);
      const schedule = current
        ? await tx.feeSchedule.update({ where: { activityId, rowVersion: data.rowVersion }, data: { registrationBaseFee: data.registrationBaseFee, participantFee: data.participantFee, defaultTeamEntryFee: data.defaultTeamEntryFee, updatedById: actor, rowVersion: { increment: 1 } } })
        : await tx.feeSchedule.create({ data: { activityId, registrationBaseFee: data.registrationBaseFee, participantFee: data.participantFee, defaultTeamEntryFee: data.defaultTeamEntryFee, updatedById: actor } });
      const desired = new Map(data.overrides.map((item) => [item.eventId, item.teamEntryFee]));
      const existing = await tx.eventFeeOverride.findMany({ where: { feeScheduleId: schedule.id } });
      for (const item of existing) {
        const value = desired.get(item.eventId);
        if (value === undefined || value === data.defaultTeamEntryFee) await tx.eventFeeOverride.delete({ where: { id: item.id } });
      }
      for (const item of data.overrides) {
        if (item.teamEntryFee === data.defaultTeamEntryFee) continue;
        await tx.eventFeeOverride.upsert({ where: { feeScheduleId_eventId: { feeScheduleId: schedule.id, eventId: item.eventId } }, create: { activityId, feeScheduleId: schedule.id, eventId: item.eventId, teamEntryFee: item.teamEntryFee }, update: { activityId, teamEntryFee: item.teamEntryFee } });
      }
      const saved = await tx.feeSchedule.findUniqueOrThrow({ where: { id: schedule.id }, include: { feeOverrides: true } });
      
      return saved;
    });
  }

  async updateOverride(request: RequestContext, activityId: string, input: unknown) {
    const actor = await this.activityStaff(request, activityId, ["SYSTEM_ADMIN"]);
    const data = parse(overrideInput, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { registrationOpensAt: true } });
      if (!activity) fail("NOT_FOUND", "找不到活動", 404);
      assertPreRegistrationEdit(activity, "報名已開始，本年度報名費設定已鎖定。");
      const schedule = await tx.feeSchedule.findUnique({ where: { activityId } });
      if (!schedule) fail("VALIDATION_FAILED", "請先設定年度費用", 422);
      const event = await tx.competitionEvent.findFirst({ where: { id: data.eventId, activityId } });
      if (!event) fail("NOT_FOUND", "找不到同一活動的賽事項目", 404);
      const existing = await tx.eventFeeOverride.findUnique({ where: { feeScheduleId_eventId: { feeScheduleId: schedule.id, eventId: data.eventId } } });
      if (data.teamEntryFee === schedule.defaultTeamEntryFee) {
        if (existing) await tx.eventFeeOverride.delete({ where: { id: existing.id } });
        return { deleted: true, eventId: data.eventId };
      }
      const override = await tx.eventFeeOverride.upsert({ where: { feeScheduleId_eventId: { feeScheduleId: schedule.id, eventId: data.eventId } }, create: { activityId, feeScheduleId: schedule.id, eventId: data.eventId, teamEntryFee: data.teamEntryFee }, update: { activityId, teamEntryFee: data.teamEntryFee } });
      
      return override;
    });
  }

  async detail(request: RequestContext, registrationId: string) {
    parse(uuid, registrationId);
    const actor = await this.actor(request);
    const registration = await this.db.registration.findUnique({ where: { id: registrationId }, include: { totalRosterAttachment: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } } } });
    if (!registration) fail("NOT_FOUND", "找不到報名", 404);
    await this.competition.registrationScope(this.db, actor.user.id, registration, true, Boolean(registration.leagueId));
    const calculation = await this.finance.calculate(this.db, registrationId);
    const eligibility = await this.eligibility.evaluate(registrationId);
    const activity = await this.db.activity.findUnique({ where: { id: registration.activityId }, select: { remittanceInstructions: true } });
    return { ...calculation, eligibility, totalRosterAttachment: registration.totalRosterAttachment, remittanceInstructions: activity?.remittanceInstructions ?? null };
  }

  async createPayment(request: RequestContext, registrationId: string, input: unknown) {
    parse(uuid, registrationId);
    const actor = await this.actor(request);
    const data = parse(paymentInput, input);
    const scopedRegistration = await this.registration(registrationId);
    await this.competition.registrationScope(this.db, actor.user.id, scopedRegistration, false, Boolean(scopedRegistration.leagueId));
    return this.db.$transaction(async (tx) => {
      await lock(tx, `registration:${registrationId}`);
      const registration = await tx.registration.findUnique({ where: { id: registrationId } });
      if (!registration) fail("NOT_FOUND", "找不到報名", 404);
      const pendingPayment = await tx.payment.findFirst({ where: { registrationId, status: "SUBMITTED" }, select: { id: true } });
      if (pendingPayment) fail("PAYMENT_ALREADY_SUBMITTED", "此報名已有一筆待審核付款資料，請勿重複送出；如需補費請等待主辦單位通知。", 409);
      if (data.proofAttachmentId) {
        const attachment = await tx.attachment.findUnique({ where: { id: data.proofAttachmentId } });
        if (!attachment || attachment.activityId !== registration.activityId || attachment.uploadedById !== actor.user.id || attachment.purpose !== "PAYMENT_PROOF") fail("FORBIDDEN", "付款證明沒有授權", 403);
      }
      const payment = await tx.payment.create({ data: { activityId: registration.activityId, registrationId, amount: data.amount, paidAt: data.paidAt, payerName: data.payerName ?? null, bankAccountLastFive: data.bankAccountLastFive ?? null, reference: data.reference ?? null, proofAttachmentId: data.proofAttachmentId ?? null, submittedByUserId: actor.user.id } });
      
      return payment;
    });
  }

  async uploadProof(request: RequestContext, registrationId: string, input: unknown) {
    parse(uuid, registrationId);
    const actor = await this.actor(request);
    const registration = await this.registration(registrationId);
    await this.competition.registrationScope(this.db, actor.user.id, registration, false, Boolean(registration.leagueId));
    const body = parse(z.object({ filename: z.string().min(1).max(240), mime: z.string().trim().max(120), base64: z.string().min(1).max(Math.ceil((10 * 1024 * 1024 * 4) / 3) + 16) }).strict(), input);
    const file = validateProof(body);
    const stored = await putProof(file);
    try {
      const attachment = await this.db.attachment.create({ data: { activityId: registration.activityId, uploadedById: actor.user.id, purpose: "PAYMENT_PROOF", storageKey: stored.storageKey, originalName: file.originalName, mimeType: file.mimeType, sizeBytes: stored.sizeBytes, sha256: stored.sha256 } });
      return { id: attachment.id, originalName: attachment.originalName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, sha256: attachment.sha256, createdAt: attachment.createdAt };
    } catch (error) {
      await removeProof(stored.storageKey);
      throw error;
    }
  }

  async uploadTotalRoster(request: RequestContext, registrationId: string, input: unknown) {
    parse(uuid, registrationId);
    const actor = await this.actor(request);
    const body = parse(documentInput, input);
    const file = validateTotalRoster(body);
    const registration = await this.registration(registrationId);
    if (registration.leagueId) fail("UNSUPPORTED", "本功能僅適用於社團報名", 409);
    await this.competition.registrationScope(this.db, actor.user.id, registration, false, false);
    const stored = await putProof(file);
    try {
      const attachment = await this.db.$transaction(async (tx) => {
        await lock(tx, `registration:${registrationId}`);
        const current = await tx.registration.findUnique({ where: { id: registrationId } });
        if (!current) fail("NOT_FOUND", "找不到報名", 404);
        if (current.leagueId) fail("UNSUPPORTED", "本功能僅適用於社團報名", 409);
        await this.competition.registrationScope(tx, actor.user.id, current, false, false);
        const activity = await tx.activity.findUnique({ where: { id: current.activityId } });
        if (!activity) fail("NOT_FOUND", "找不到活動", 404);
        if (!['DRAFT', 'RETURNED'].includes(current.status)) fail("REGISTRATION_LOCKED", "報名已送出審核，無法更換總參賽名單", 409);
        assertRegistrationSubmissionStage(activity, current);
        const created = await tx.attachment.create({ data: { activityId: current.activityId, uploadedById: actor.user.id, purpose: "TOTAL_ROSTER", storageKey: stored.storageKey, originalName: file.originalName, mimeType: file.mimeType, sizeBytes: stored.sizeBytes, sha256: stored.sha256 } });
        await tx.registration.update({ where: { id: current.id }, data: { totalRosterAttachmentId: created.id, rowVersion: { increment: 1 } } });
        
        return created;
      });
      return { id: attachment.id, originalName: attachment.originalName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, sha256: attachment.sha256, createdAt: attachment.createdAt };
    } catch (error) {
      await removeProof(stored.storageKey);
      throw error;
    }
  }

  async downloadProof(request: RequestContext, attachmentId: string) {
    parse(uuid, attachmentId);
    const actor = await this.actor(request);
    const attachment = await this.db.attachment.findUnique({ where: { id: attachmentId }, include: { payments: { select: { registrationId: true, activityId: true } } } });
    if (!attachment || !attachment.payments.length) fail("NOT_FOUND", "找不到付款證明", 404);
    const registration = await this.registration(attachment.payments[0]!.registrationId);
    await this.competition.registrationScope(this.db, actor.user.id, registration, true, Boolean(registration.leagueId));
    if (attachment.activityId !== registration.activityId) fail("FORBIDDEN", "付款證明沒有授權", 403);
    const bytes = await readProof(attachment.storageKey);
    return { bytes, mimeType: attachment.mimeType, originalName: attachment.originalName };
  }

  async downloadTotalRoster(request: RequestContext, registrationId: string) {
    parse(uuid, registrationId);
    const actor = await this.actor(request);
    const registration = await this.db.registration.findUnique({ where: { id: registrationId }, include: { totalRosterAttachment: true } });
    if (!registration || !registration.totalRosterAttachment || registration.totalRosterAttachment.purpose !== "TOTAL_ROSTER") fail("NOT_FOUND", "找不到總參賽名單（學校核章）", 404);
    await this.competition.registrationScope(this.db, actor.user.id, registration, true, Boolean(registration.leagueId));
    if (registration.totalRosterAttachment.activityId !== registration.activityId) fail("FORBIDDEN", "總參賽名單沒有授權", 403);
    const bytes = await readProof(registration.totalRosterAttachment.storageKey);
    return { bytes, mimeType: registration.totalRosterAttachment.mimeType, originalName: registration.totalRosterAttachment.originalName };
  }

  async paymentReview(request: RequestContext, activityId: string) {
    await this.activityStaff(request, activityId, ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"]);
    return this.db.payment.findMany({ where: { activityId, status: "SUBMITTED" }, include: { registration: { include: { organization: true, league: true } }, submittedBy: { select: { id: true, displayName: true, email: true } }, attachment: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } } }, orderBy: { createdAt: "asc" } });
  }

  async reviewPayment(request: RequestContext, paymentId: string, status: "CONFIRMED" | "REJECTED", input: unknown) {
    parse(uuid, paymentId);
    const data = parse(paymentReviewInput, input);
    const payment = await this.db.payment.findUnique({ where: { id: paymentId } });
    if (!payment) fail("NOT_FOUND", "找不到付款紀錄", 404);
    const actor = await this.activityStaff(request, payment.activityId, ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"]);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `payment:${paymentId}`);
      const current = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!current) fail("NOT_FOUND", "找不到付款紀錄", 404);
      if (current.status !== "SUBMITTED") fail("PAYMENT_MISMATCH", "付款紀錄目前不可審核", 409);
      if (current.rowVersion !== data.rowVersion) fail("STALE_VERSION", "付款紀錄已被其他人更新，請重新整理");
      const reviewNote = [data.receivedAmount === undefined ? null : `實收金額：NT$${data.receivedAmount.toLocaleString("zh-TW")}`, data.reason || null].filter(Boolean).join("；") || null;
      const updated = await tx.payment.update({ where: { id: paymentId, rowVersion: data.rowVersion }, data: { status, reviewedByUserId: actor, reviewedAt: new Date(), reviewNote, rowVersion: { increment: 1 } } });
      
      return updated;
    });
  }

  async createRefund(request: RequestContext, registrationId: string, input: unknown) {
    parse(uuid, registrationId);
    const actor = await this.actor(request);
    const data = parse(refundInput, input);
    const registration = await this.registration(registrationId);
    await this.competition.registrationScope(this.db, actor.user.id, registration, false, Boolean(registration.leagueId));
    return this.db.$transaction(async (tx) => {
      await lock(tx, `registration:${registrationId}`);
      const calculation = await this.finance.calculate(tx, registrationId);
      const available = calculation.availableRefundRequest;
      if (available <= 0) fail("REFUND_NOT_AVAILABLE", "目前沒有可申請的退款餘額", 422, { available: 0, credit: calculation.credit });
      if (data.amount > available) fail("REFUND_AMOUNT_EXCEEDS_CREDIT", "退款金額不可超過目前可退餘額", 422, { available, credit: calculation.credit });
      const refund = await tx.refund.create({ data: { activityId: registration.activityId, registrationId, amount: data.amount, reason: data.reason, createdByUserId: actor.user.id } });
      
      return refund;
    });
  }

  async refundReview(request: RequestContext, activityId: string) {
    await this.activityStaff(request, activityId, ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"]);
    return this.db.refund.findMany({ where: { activityId }, include: { registration: { include: { organization: true, league: true } } }, orderBy: { createdAt: "asc" } });
  }

  async reviewRefund(request: RequestContext, refundId: string, status: "COMPLETED" | "CANCELLED", input: unknown) {
    parse(uuid, refundId);
    const data = parse(refundMutation, input);
    const refund = await this.db.refund.findUnique({ where: { id: refundId } });
    if (!refund) fail("NOT_FOUND", "找不到退款紀錄", 404);
    const actor = await this.activityStaff(request, refund.activityId, ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"]);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `registration:${refund.registrationId}`);
      const current = await tx.refund.findUnique({ where: { id: refundId } });
      if (!current) fail("NOT_FOUND", "找不到退款紀錄", 404);
      if (current.status !== "REQUESTED") fail("PAYMENT_MISMATCH", "退款紀錄目前不可處理", 409);
      if (current.rowVersion !== data.rowVersion) fail("STALE_VERSION", "退款紀錄已被其他人更新，請重新整理");
      if (status === "COMPLETED") {
        const calculation = await this.finance.calculate(tx, refund.registrationId);
        const otherOutstanding = calculation.refunds
          .filter((item) => item.status === "REQUESTED" && item.id !== current.id)
          .reduce((sum, item) => sum + item.amount, 0);
        const availableForCurrent = Math.max(0, calculation.credit - otherOutstanding);
        if (current.amount > availableForCurrent)
          fail("REFUND_CREDIT_CHANGED", "應繳金額或其他退款已變更，目前可退餘額不足", 409, {
            requested: current.amount,
            available: availableForCurrent,
            credit: calculation.credit,
          });
      }
      const updated = await tx.refund.update({ where: { id: refundId, rowVersion: data.rowVersion }, data: { status, completedByUserId: status === "COMPLETED" ? actor : null, completedAt: status === "COMPLETED" ? new Date() : null, rowVersion: { increment: 1 } } });
      
      return updated;
    });
  }

  private async registration(registrationId: string) {
    const registration = await this.db.registration.findUnique({ where: { id: registrationId } });
    if (!registration) fail("NOT_FOUND", "找不到報名", 404);
    return registration;
  }
}
