import { Body, Controller, Get, Param, Patch, Post, Req, Res } from "@nestjs/common";
import type { RequestContext } from "./core.js";
import { FinanceService } from "./finance.service.js";

@Controller()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get("activities/:activityId/fee-schedule")
  feeSchedule(@Req() req: RequestContext, @Param("activityId") activityId: string) {
    return this.finance.getFeeSchedule(req, activityId);
  }

  @Patch("activities/:activityId/fee-schedule")
  updateFeeSchedule(@Req() req: RequestContext, @Param("activityId") activityId: string, @Body() body: unknown) {
    return this.finance.updateFeeSchedule(req, activityId, body);
  }

  @Patch("activities/:activityId/fee-overrides")
  updateOverride(@Req() req: RequestContext, @Param("activityId") activityId: string, @Body() body: unknown) {
    return this.finance.updateOverride(req, activityId, body);
  }

  @Patch("activities/:activityId/fee-configuration")
  updateConfiguration(@Req() req: RequestContext, @Param("activityId") activityId: string, @Body() body: unknown) {
    return this.finance.updateFeeConfiguration(req, activityId, body);
  }

  @Patch("activities/:activityId/remittance-instructions")
  updateRemittanceInstructions(@Req() req: RequestContext, @Param("activityId") activityId: string, @Body() body: unknown) {
    return this.finance.updateRemittanceInstructions(req, activityId, body);
  }

  @Get("registrations/:registrationId/finance")
  detail(@Req() req: RequestContext, @Param("registrationId") registrationId: string) {
    return this.finance.detail(req, registrationId);
  }

  @Post("registrations/:registrationId/payments")
  createPayment(@Req() req: RequestContext, @Param("registrationId") registrationId: string, @Body() body: unknown) {
    return this.finance.createPayment(req, registrationId, body);
  }

  @Post("registrations/:registrationId/payment-proof")
  uploadProof(@Req() req: RequestContext, @Param("registrationId") registrationId: string, @Body() body: unknown) {
    return this.finance.uploadProof(req, registrationId, body);
  }

  @Post("registrations/:registrationId/total-roster")
  uploadTotalRoster(@Req() req: RequestContext, @Param("registrationId") registrationId: string, @Body() body: unknown) {
    return this.finance.uploadTotalRoster(req, registrationId, body);
  }

  @Get("registrations/:registrationId/total-roster")
  async downloadTotalRoster(@Req() req: RequestContext, @Param("registrationId") registrationId: string, @Res() response: { setHeader(name: string, value: string): void; status(code: number): { end(body: Buffer): void } }) {
    const file = await this.finance.downloadTotalRoster(req, registrationId);
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Disposition", `attachment; filename="${file.originalName.replace(/["\\\r\n]/g, "_")}"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.status(200).end(file.bytes);
  }

  @Get("attachments/:attachmentId/content")
  async downloadProof(@Req() req: RequestContext, @Param("attachmentId") attachmentId: string, @Res() response: { setHeader(name: string, value: string): void; status(code: number): { end(body: Buffer): void } }) {
    const file = await this.finance.downloadProof(req, attachmentId);
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Disposition", `attachment; filename="${file.originalName.replace(/["\\\r\n]/g, "_")}"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.status(200).end(file.bytes);
  }

  @Get("activities/:activityId/payment-review")
  paymentReview(@Req() req: RequestContext, @Param("activityId") activityId: string) {
    return this.finance.paymentReview(req, activityId);
  }

  @Post("payments/:paymentId/confirm")
  confirmPayment(@Req() req: RequestContext, @Param("paymentId") paymentId: string, @Body() body: unknown) {
    return this.finance.reviewPayment(req, paymentId, "CONFIRMED", body);
  }

  @Post("payments/:paymentId/reject")
  rejectPayment(@Req() req: RequestContext, @Param("paymentId") paymentId: string, @Body() body: unknown) {
    return this.finance.reviewPayment(req, paymentId, "REJECTED", body);
  }

  @Post("registrations/:registrationId/refunds")
  createRefund(@Req() req: RequestContext, @Param("registrationId") registrationId: string, @Body() body: unknown) {
    return this.finance.createRefund(req, registrationId, body);
  }

  @Get("activities/:activityId/refund-review")
  refundReview(@Req() req: RequestContext, @Param("activityId") activityId: string) {
    return this.finance.refundReview(req, activityId);
  }

  @Post("refunds/:refundId/complete")
  completeRefund(@Req() req: RequestContext, @Param("refundId") refundId: string, @Body() body: unknown) {
    return this.finance.reviewRefund(req, refundId, "COMPLETED", body);
  }

  @Post("refunds/:refundId/cancel")
  cancelRefund(@Req() req: RequestContext, @Param("refundId") refundId: string, @Body() body: unknown) {
    return this.finance.reviewRefund(req, refundId, "CANCELLED", body);
  }
}
