import { Injectable } from "@nestjs/common";
import type { PaymentStatus, RefundStatus, TeamAdmissionStatus } from "@prisma/client";
import { Database, fail, type Tx } from "./core.js";

type RegistrationWithFinance = {
  id: string;
  activityId: string;
  status: string;
  submittedAt: Date | null;
  eventEntries: Array<{
    id: string;
    eventId: string;
    event: { id: string; name: string };
    teams: Array<{
      id: string;
      ordinal: number;
      admissionStatus: TeamAdmissionStatus;
      members: Array<{ participantId: string; active: boolean; participant: { active: boolean } }>;
    }>;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    status: PaymentStatus;
    paidAt: Date;
    reference: string | null;
    payerName: string | null;
    bankAccountLastFive: string | null;
    proofAttachmentId: string | null;
    rowVersion: number;
    submittedByUserId: string;
    reviewedByUserId: string | null;
    reviewNote: string | null;
  }>;
  refunds: Array<{ id: string; amount: number; status: RefundStatus; reason: string; rowVersion: number }>;
};

@Injectable()
export class FinanceCalculationService {
  async calculate(db: Database | Tx, registrationId: string) {
    const registration = await db.registration.findUnique({
      where: { id: registrationId },
      include: {
        eventEntries: {
          where: { active: true },
          include: {
            event: true,
            teams: {
              include: {
                members: { where: { active: true }, include: { participant: true } },
              },
            },
          },
        },
        payments: { orderBy: { createdAt: "asc" } },
        refunds: { orderBy: { createdAt: "asc" } },
      },
    }) as RegistrationWithFinance | null;
    if (!registration) fail("NOT_FOUND", "找不到報名", 404);

    const schedule = await db.feeSchedule.findUnique({
      where: { activityId: registration.activityId },
      include: { feeOverrides: true },
    });
    const participants = new Set<string>();
    const eventFees = registration.eventEntries.map((entry) => {
      const admittedTeams = entry.teams.filter((team) => team.admissionStatus === "ADMITTED");
      for (const team of admittedTeams) {
        for (const member of team.members) {
          if (member.active && member.participant.active) participants.add(member.participantId);
        }
      }
      const override = schedule?.feeOverrides.find((item) => item.eventId === entry.eventId);
      const unitFee = override?.teamEntryFee ?? schedule?.defaultTeamEntryFee ?? 0;
      return {
        eventId: entry.eventId,
        eventName: entry.event.name,
        teamCount: entry.teams.length,
        admittedTeamCount: admittedTeams.length,
        pendingTeamCount: entry.teams.filter((team) => team.admissionStatus === "PENDING").length,
        rejectedTeamCount: entry.teams.filter((team) => team.admissionStatus === "REJECTED").length,
        unitFee,
        subtotal: admittedTeams.length > 0 ? unitFee : 0,
        billed: admittedTeams.length > 0,
        overridden: Boolean(override),
      };
    });
    const baseFee = schedule?.registrationBaseFee ?? 0;
    const participantFeeSubtotal = participants.size * (schedule?.participantFee ?? 0);
    const eventTeamFeeSubtotal = eventFees.reduce((sum, item) => sum + item.subtotal, 0);
    const amountDue = baseFee + participantFeeSubtotal + eventTeamFeeSubtotal;
    const confirmedPayments = registration.payments
      .filter((payment) => payment.status === "CONFIRMED")
      .reduce((sum, payment) => sum + payment.amount, 0);
    const completedRefunds = registration.refunds
      .filter((refund) => refund.status === "COMPLETED")
      .reduce((sum, refund) => sum + refund.amount, 0);
    const outstandingRefundRequests = registration.refunds
      .filter((refund) => refund.status === "REQUESTED")
      .reduce((sum, refund) => sum + refund.amount, 0);
    const netPaid = confirmedPayments - completedRefunds;
    const balanceDue = Math.max(0, amountDue - netPaid);
    const credit = Math.max(0, netPaid - amountDue);
    return {
      registrationId,
      status: registration.status,
      submittedAt: registration.submittedAt,
      scheduleConfigured: Boolean(schedule),
      baseFee,
      participantCount: participants.size,
      participantFee: schedule?.participantFee ?? 0,
      participantFeeSubtotal,
      eventTeamFeeSubtotal,
      eventFees,
      amountDue,
      confirmedPayments,
      completedRefunds,
      outstandingRefundRequests,
      netPaid,
      balanceDue,
      credit,
      availableRefundRequest: Math.max(0, credit - outstandingRefundRequests),
      financiallyEligible: Boolean(schedule) && netPaid >= amountDue,
      settled: Boolean(schedule) && netPaid >= amountDue,
      payments: registration.payments,
      refunds: registration.refunds,
    };
  }
}
