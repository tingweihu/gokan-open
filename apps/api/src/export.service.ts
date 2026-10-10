import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Database, fail, parse, uuid, type RequestContext } from "./core.js";
import { IdentityService } from "./identity.service.js";
import { RegistrationValidationService } from "./registration-validation.service.js";
import { FinanceCalculationService } from "./finance-calculation.service.js";
import { safeCell } from "./spreadsheet.js";
import { operatingStage } from "./stage.js";

const filterSchema = z.object({ eventId: uuid.optional() }).strict();
const gradeLabel: Record<string, string> = { GRADE_1: "一年級", GRADE_2: "二年級", GRADE_3: "三年級" };
const genderLabel: Record<string, string> = { MALE: "男", FEMALE: "女" };

type FinalSnapshotRegistration = {
  registrationId: string;
  unit?: { id?: string; name?: string; kind?: "CLUB" | "LEAGUE" } | null;
  eventEntries?: Array<{
    eventId: string;
    eventName: string;
    teams: Array<{
      ordinal: number;
      admissionStatus: string;
      members: Array<{
        participantId: string;
        name: string;
        gender: string;
        grade: string;
        sourceOrganizationId: string;
        sourceClub?: string;
      }>;
    }>;
  }>;
};

function finalRows(payload: Prisma.JsonValue, allowedRegistrationIds?: Set<string>) {
  const registrations = (Array.isArray(payload) ? payload : []) as unknown as FinalSnapshotRegistration[];
  const result = [];
  for (const registration of registrations) {
    if (allowedRegistrationIds && !allowedRegistrationIds.has(registration.registrationId)) continue;
    for (const entry of registration.eventEntries ?? []) {
      for (const team of entry.teams) {
        if (team.admissionStatus !== "ADMITTED") continue;
        for (const member of team.members) result.push({
          registrationId: registration.registrationId,
          registrationUnit: registration.unit?.name ?? "",
          eventId: entry.eventId,
          sourceClub: member.sourceClub ?? member.sourceOrganizationId,
          participantId: member.participantId,
          participant: member.name,
          grade: gradeLabel[member.grade] ?? member.grade,
          gender: genderLabel[member.gender] ?? member.gender,
          event: entry.eventName,
          team: `第 ${team.ordinal} 隊`,
        });
      }
    }
  }
  return result;
}

function rows<T extends Record<string, unknown>>(items: T[]) {
  return items.map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, safeCell(value instanceof Date ? value.toISOString() : value)])));
}

function addSheet(book: ExcelJS.Workbook, name: string, data: Record<string, unknown>[]) {
  const sheet = book.addWorksheet(name);
  if (!data.length) {
    sheet.addRow(["無資料"]);
    return;
  }
  const keys = Object.keys(data[0]!);
  sheet.addRow(keys);
  for (const item of rows(data)) sheet.addRow(keys.map((key) => item[key]));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF175C3A" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
  sheet.columns.forEach((column) => { column.width = 22; });
}

function csvCell(value: unknown) {
  const text = String(safeCell(value ?? ""));
  return '"' + text.replaceAll('"', '""') + '"';
}

async function deterministicZip(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const epoch = new Date(0);
  for (const entry of Object.values(zip.files)) entry.date = epoch;
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

@Injectable()
export class ExportService {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityService,
    private readonly validation: RegistrationValidationService,
    private readonly finance: FinanceCalculationService,
  ) {}

  private async actor(request: RequestContext, activityId: string, roles: ("SYSTEM_ADMIN" | "REGISTRATION_FINANCE" | "CHECKIN_EXPORT")[]) {
    parse(uuid, activityId);
    const session = await this.identity.authenticate(request);
    await this.identity.staff(this.db, session.user.id, activityId, roles);
    return session.user.id;
  }

  async rosterWorkbook(request: RequestContext, activityId: string, organizationId?: string) {
    const actor = await this.actor(request, activityId, ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"]);
    parse(z.object({ organizationId: uuid.optional() }).strict(), { organizationId: organizationId || undefined });
    const activity = await this.db.activity.findUnique({ where: { id: activityId }, select: { year: true } });
    if (!activity) fail("NOT_FOUND", "找不到年度活動", 404);
    if (organizationId) {
      const organization = await this.db.organization.findFirst({ where: { id: organizationId, activityId }, select: { id: true } });
      if (!organization) fail("NOT_FOUND", "找不到同一活動的社團", 404);
    }
    const participants = await this.db.participant.findMany({
      where: { activityId, sourceOrganizationId: organizationId },
      include: { sourceOrganization: { select: { name: true } } },
      orderBy: [{ sourceOrganization: { name: "asc" } }, { name: "asc" }],
    });
    const book = new ExcelJS.Workbook();
    book.creator = "Gokan";
    book.created = new Date(0);
    addSheet(book, "選手名單", participants.map((participant) => ({
      姓名: participant.name,
      所屬社團: participant.sourceOrganization.name,
      性別: genderLabel[participant.gender] ?? participant.gender,
      年級: gradeLabel[participant.grade] ?? participant.grade,
      狀態: participant.active ? "有效" : "停用",
    })));
    const buffer = await deterministicZip(Buffer.from(await book.xlsx.writeBuffer()));
    
    return { filename: `gokan-${activity.year}-roster${organizationId ? "-organization" : ""}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer };
  }

  private async annualData(activityId: string) {
    const activity = await this.db.activity.findUnique({ where: { id: activityId } });
    if (!activity) fail("NOT_FOUND", "找不到年度活動", 404);
    const [clubs, memberships, leagues, leagueMembers, participants, events, windows, registrations, entries, teams, members, payments, refunds] = await Promise.all([
      this.db.organization.findMany({ where: { activityId }, orderBy: { code: "asc" } }),
      this.db.organizationMembership.findMany({ where: { organization: { activityId } }, include: { organization: true, user: true }, orderBy: { createdAt: "asc" } }),
      this.db.league.findMany({ where: { activityId }, orderBy: { name: "asc" } }),
      this.db.leagueMember.findMany({ where: { activityId }, include: { league: true, organization: true }, orderBy: { createdAt: "asc" } }),
      this.db.participant.findMany({ where: { activityId }, include: { sourceOrganization: true }, orderBy: [{ sourceOrganizationId: "asc" }, { name: "asc" }] }),
      this.db.competitionEvent.findMany({ where: { activityId }, orderBy: [{ displayOrder: "asc" }, { code: "asc" }] }),
      this.db.eventTimeWindow.findMany({ where: { activityId }, include: { event: true, scheduleVersion: true }, orderBy: [{ startAt: "asc" }, { ordinal: "asc" }] }),
      this.db.registration.findMany({ where: { activityId }, include: { organization: true, league: true }, orderBy: { createdAt: "asc" } }),
      this.db.eventEntry.findMany({ where: { activityId }, include: { event: true }, orderBy: { createdAt: "asc" } }),
      this.db.team.findMany({ where: { eventEntry: { activityId } }, include: { eventEntry: { include: { event: true } } }, orderBy: { createdAt: "asc" } }),
      this.db.teamMember.findMany({ where: { activityId }, include: { participant: true, team: true, eventEntry: { include: { event: true } } }, orderBy: { createdAt: "asc" } }),
      this.db.payment.findMany({ where: { activityId }, orderBy: { createdAt: "asc" } }),
      this.db.refund.findMany({ where: { activityId }, orderBy: { createdAt: "asc" } }),
    ]);
    const validation = await Promise.all(registrations.map(async (registration) => {
      const result = await this.validation.validate(this.db, registration.id);
      return { registrationId: registration.id, unit: registration.organization?.name ?? registration.league?.name ?? "", status: registration.status, eligible: result.eligible, blockers: result.blockers.map((item) => item.message).join("；"), warnings: result.warnings.map((item) => item.message).join("；") };
    }));
    const fees = await Promise.all(registrations.map(async (registration) => {
      const result = await this.finance.calculate(this.db, registration.id);
      return { registrationId: registration.id, unit: registration.organization?.name ?? registration.league?.name ?? "", amountDue: result.amountDue, confirmedPayments: result.confirmedPayments, completedRefunds: result.completedRefunds, netPaid: result.netPaid, balanceDue: result.balanceDue, credit: result.credit, participantCount: result.participantCount };
    }));
    return {
      activity: { id: activity.id, code: activity.code, name: activity.name, year: activity.year, timezone: activity.timezone, status: activity.status, registrationOpensAt: activity.registrationOpensAt, registrationClosesAt: activity.registrationClosesAt, paymentDueAt: activity.paymentDueAt, leaderMeetingStartsAt: activity.leaderMeetingStartsAt, leaderMeetingEndsAt: activity.leaderMeetingEndsAt, competitionStartsAt: activity.competitionStartsAt, competitionEndsAt: activity.competitionEndsAt },
      sheets: {
        "Clubs": clubs.map((x) => ({ id: x.id, code: x.code, name: x.name, shortName: x.shortName, active: x.active })),
        "Club users": memberships.map((x) => ({ clubId: x.organizationId, club: x.organization.name, displayName: x.user.displayName, email: x.user.email, role: x.role, revokedAt: x.revokedAt })),
        "Leagues": leagues.map((x) => ({ id: x.id, name: x.name, ownerClubId: x.ownerOrganizationId, status: x.status })),
        "League members": leagueMembers.map((x) => ({ leagueId: x.leagueId, league: x.league.name, clubId: x.organizationId, club: x.organization.name, status: x.status, confirmedAt: x.confirmedAt })),
        "Participants": participants.map((x) => ({ id: x.id, club: x.sourceOrganization.name, name: x.name, grade: gradeLabel[x.grade], gender: genderLabel[x.gender], active: x.active })),
        "Competition events": events.map((x) => ({ id: x.id, code: x.code, name: x.name, enabled: x.enabled, minTeamSize: x.minTeamSize, maxTeamSize: x.maxTeamSize, maxTeams: x.maxTeamsPerRegistration })),
        "Event time windows": windows.map((x) => ({ scheduleVersion: x.scheduleVersion.version, scheduleStatus: x.scheduleVersion.status, event: x.event.name, ordinal: x.ordinal, startAt: x.startAt, endAt: x.endAt, venue: x.venue, label: x.label })),
        "Registrations": registrations.map((x) => ({ id: x.id, club: x.organization?.name ?? "", league: x.league?.name ?? "", status: x.status, submittedAt: x.submittedAt, confirmedAt: x.confirmedAt })),
        "Event entries": entries.map((x) => ({ id: x.id, registrationId: x.registrationId, event: x.event.name, source: x.source, active: x.active })),
        "Teams": teams.map((x) => ({ id: x.id, registrationId: x.eventEntry.registrationId, event: x.eventEntry.event.name, ordinal: x.ordinal, name: x.name })),
        "Team members": members.map((x) => ({ teamId: x.teamId, event: x.eventEntry.event.name, teamOrdinal: x.team.ordinal, participantId: x.participantId, participant: x.participant.name, active: x.active })),
        "Validation eligibility summary": validation,
        "Fee summary": fees,
        "Payments": payments.map((x) => ({ id: x.id, registrationId: x.registrationId, amount: x.amount, paidAt: x.paidAt, status: x.status, payerName: x.payerName, bankAccountLastFive: x.bankAccountLastFive, reference: x.reference, proofAttachmentId: x.proofAttachmentId })),
        "Refunds": refunds.map((x) => ({ id: x.id, registrationId: x.registrationId, amount: x.amount, reason: x.reason, status: x.status, completedAt: x.completedAt })),
      },
    };
  }

  async annualWorkbook(request: RequestContext, activityId: string) {
    const actor = await this.actor(request, activityId, ["SYSTEM_ADMIN"]);
    const data = await this.annualData(activityId);
    const book = new ExcelJS.Workbook();
    book.creator = "Gokan";
    book.created = new Date(0);
    book.modified = new Date(0);
    for (const [name, sheetRows] of Object.entries(data.sheets)) addSheet(book, name, sheetRows);
    const buffer = await deterministicZip(Buffer.from(await book.xlsx.writeBuffer()));
    
    return { filename: `gokan-${data.activity.year}-annual.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer };
  }

  async annualArchive(request: RequestContext, activityId: string) {
    const actor = await this.actor(request, activityId, ["SYSTEM_ADMIN"]);
    const data = await this.annualData(activityId);
    
    return { filename: `gokan-${data.activity.year}-archive.json`, mime: "application/json; charset=utf-8", buffer: Buffer.from(JSON.stringify(data, null, 2), "utf8") };
  }

  async checkInRows(request: RequestContext, activityId: string, filter: unknown) {
    const actor = await this.actor(request, activityId, ["SYSTEM_ADMIN", "CHECKIN_EXPORT"]);
    const data = parse(filterSchema, filter);
    const meeting = await this.db.leaderMeeting.findUnique({
      where: { activityId },
      include: { snapshots: { where: { kind: "FINAL" }, take: 1 } },
    });
    const snapshot = meeting?.snapshots[0];
    if (meeting?.status !== "CLOSED" || !snapshot)
      fail("FINAL_PACK_NOT_READY", "領隊會議尚未完成，正式檢錄名單尚未建立", 409);
    const result = finalRows(snapshot.payload)
      .filter((row) => !data.eventId || row.eventId === data.eventId)
      .sort((left, right) => left.event.localeCompare(right.event, "zh-TW") || left.participant.localeCompare(right.participant, "zh-TW"))
      .map((row) => ({ eventId: row.eventId, "賽事項目": safeCell(row.event), "選手姓名": safeCell(row.participant), "年級": row.grade, "性別": row.gender }));
    
    return result;
  }

  async checkInWorkbook(request: RequestContext, activityId: string, filter: unknown) {
    const data = await this.checkInRows(request, activityId, filter);
    const book = new ExcelJS.Workbook();
    book.creator = "Gokan";
    book.created = new Date(0);
    book.modified = new Date(0);
    addSheet(book, "檢錄名單", data.map((item) => ({ "賽事項目": item["賽事項目"], "選手姓名": item["選手姓名"], "年級": item["年級"], "性別": item["性別"] })));
    return { filename: "高康盃檢錄名單.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await book.xlsx.writeBuffer()) };
  }

  async checkInCsv(request: RequestContext, activityId: string, filter: unknown) {
    const data = await this.checkInRows(request, activityId, filter);
    const keys = ["賽事項目", "選手姓名", "年級", "性別"];
    const text = [keys.map(csvCell).join(","), ...data.map((item) => keys.map((key) => csvCell(item[key as keyof typeof item])).join(","))].join("\r\n");
    return { filename: "高康盃檢錄名單.csv", mime: "text/csv; charset=utf-8", buffer: Buffer.from("\ufeff" + text, "utf8") };
  }

  async finalPack(request: RequestContext, activityId: string) {
    parse(uuid, activityId);
    const session = await this.identity.authenticate(request);
    const activity = await this.db.activity.findUnique({ where: { id: activityId } });
    if (!activity) fail("NOT_FOUND", "找不到年度活動", 404);
    const stage = operatingStage(activity);
    const staffAssignments = await this.db.activityStaff.findMany({ where: { userId: session.user.id, activityId, revokedAt: null }, select: { role: true } });
    const isAdmin = staffAssignments.some((item) => item.role === "SYSTEM_ADMIN");
    const memberships = await this.db.organizationMembership.findMany({ where: { userId: session.user.id, revokedAt: null, organization: { activityId, active: true } }, select: { organizationId: true } });
    if (!isAdmin && !memberships.length) fail("FORBIDDEN", "您沒有此年度的最終資料權限", 403);
    const meeting = await this.db.leaderMeeting.findUnique({ where: { activityId }, include: { snapshots: { where: { kind: "FINAL" }, take: 1 } } });
    const finalSnapshot = meeting?.snapshots[0];
    if (meeting?.status !== "CLOSED" || !finalSnapshot)
      return { available: false, stage, message: "領隊會議尚未完成，最終參賽資料尚未鎖定" };
    const registrations = await this.db.registration.findMany({
      where: { activityId, status: "CONFIRMED", ...(isAdmin ? {} : { OR: [{ organizationId: { in: memberships.map((item) => item.organizationId) } }, { league: { members: { some: { organizationId: { in: memberships.map((item) => item.organizationId) }, status: "CONFIRMED" } } } }] }) },
      select: { id: true },
    });
    const allowed = isAdmin ? undefined : new Set(registrations.map((registration) => registration.id));
    const snapshotRows = finalRows(finalSnapshot.payload, allowed).map((row) => ({
      registrationUnit: row.registrationUnit,
      sourceClub: row.sourceClub,
      participant: row.participant,
      grade: row.grade,
      gender: row.gender,
      event: row.event,
      team: row.team,
    }));
    return { available: true, stage, rows: snapshotRows, snapshotId: finalSnapshot.id, snapshotCapturedAt: finalSnapshot.capturedAt };
  }

  async leaderTimetable(request: RequestContext, activityId: string, registrationId?: string) {
    parse(uuid, activityId);
    if (registrationId) parse(uuid, registrationId);
    const session = await this.identity.authenticate(request);
    const activity = await this.db.activity.findUnique({ where: { id: activityId } });
    if (!activity) fail("NOT_FOUND", "找不到年度活動", 404);
    const memberships = await this.db.organizationMembership.findMany({ where: { userId: session.user.id, revokedAt: null, organization: { activityId, active: true } }, select: { organizationId: true } });
    const isStaff = await this.db.activityStaff.findFirst({ where: { userId: session.user.id, activityId, revokedAt: null, role: { in: ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"] } } });
    if (!isStaff && !memberships.length) fail("FORBIDDEN", "您沒有此年度的時程權限", 403);
    const schedule = await this.db.scheduleVersion.findFirst({ where: { activityId, status: "PUBLISHED" }, include: { timeWindows: { include: { event: true } } } });
    if (!schedule) return { published: false, items: [] };
    const registrationAccess: Prisma.RegistrationWhereInput = isStaff
      ? { status: { in: ["DRAFT", "RETURNED", "SUBMITTED", "CONFIRMED"] } }
      : {
          status: { in: ["DRAFT", "RETURNED", "SUBMITTED", "CONFIRMED"] },
          OR: [
            { organizationId: { in: memberships.map((item) => item.organizationId) } },
            { league: { members: { some: { organizationId: { in: memberships.map((item) => item.organizationId) }, status: "CONFIRMED" } } } },
          ],
        };
    const entries = await this.db.eventEntry.findMany({ where: { activityId, active: true, ...(registrationId ? { registrationId } : {}), registration: registrationAccess }, include: { event: true, registration: { include: { organization: true, league: true } }, teams: { where: { admissionStatus: { not: "REJECTED" } }, include: { members: { where: { active: true }, include: { participant: { include: { sourceOrganization: true } } } } } } } });
    const items = schedule.timeWindows.flatMap((window) => entries.filter((entry) => entry.eventId === window.eventId).map((entry) => ({ startAt: window.startAt, endAt: window.endAt, venue: window.venue, event: entry.event.name, unit: entry.registration.organization?.name ?? entry.registration.league?.name ?? "", teams: entry.teams.map((team) => ({ ordinal: team.ordinal, participants: team.members.map((member) => ({ name: member.participant.name, sourceClub: member.participant.sourceOrganization.name })) })) })));
    return { published: true, items };
  }

  async finalPackWorkbook(request: RequestContext, activityId: string) {
    const data = await this.finalPack(request, activityId);
    if (data.available !== true) fail("FINAL_PACK_NOT_READY", data.message ?? "領隊會議後將在此提供最終參賽資料", 409, data);
    const book = new ExcelJS.Workbook(); book.creator = "Gokan"; book.created = new Date(0); book.modified = new Date(0);
    addSheet(book, "最終參賽選手", data.rows ?? []);
    return { filename: "高康盃最終參賽資料.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await book.xlsx.writeBuffer()) };
  }
}
