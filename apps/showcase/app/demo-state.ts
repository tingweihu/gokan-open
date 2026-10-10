"use client";

export const DEMO_PASSWORD = "Gokan-Demo-2026!";
export const demoAccounts = [
  { email: "admin@gokan.example", label: "系統管理員", mode: "staff", role: "SYSTEM_ADMIN" },
  { email: "finance@gokan.example", label: "報名／財務", mode: "staff", role: "REGISTRATION_FINANCE" },
  { email: "checkin@gokan.example", label: "檢錄／匯出", mode: "staff", role: "CHECKIN_EXPORT" },
  { email: "leader@gokan.example", label: "領隊", mode: "leader", role: "LEADER" },
  { email: "deputy@gokan.example", label: "副領隊", mode: "leader", role: "DEPUTY" },
] as const;
export type DemoEmail = (typeof demoAccounts)[number]["email"];
export const demoNow = () => Date.parse("2026-09-28T12:00:00+08:00");
const key = "gokan-showcase:v1";

export type DemoState = {
  version: 1;
  scenario: "registration" | "review" | "meeting" | "onboarding";
  onboardingStep: number;
  role: DemoEmail | null;
  activity: Record<string, unknown>;
  clubs: Array<Record<string, any>>;
  accounts: Array<Record<string, any>>;
  participants: Array<Record<string, any>>;
  events: Array<Record<string, any>>;
  schedules: Array<Record<string, any>>;
  registrations: Array<Record<string, any>>;
  leagues: Array<Record<string, any>>;
  payments: Array<Record<string, any>>;
  refunds: Array<Record<string, any>>;
  feeSchedule: Record<string, any>;
  leagueRule: Record<string, any>;
  meeting: Record<string, any>;
  legal: Array<Record<string, any>>;
};

const date = (day: string) => `${day}T10:00:00+08:00`;
export function initialState(scenario: DemoState["scenario"] = "registration"): DemoState {
  const names = ["示範海風社", "示範山嵐社", "示範星河社", "示範青芽社"];
  const clubs = names.map((name, i) => ({ id: `club-${i + 1}`, code: `DEMO${i + 1}`, name, shortName: name.slice(2), active: true, rowVersion: 1 }));
  const participants = Array.from({ length: 60 }, (_, i) => ({
    id: `participant-${i + 1}`, name: `示範選手 ${String(i + 1).padStart(3, "0")}`,
    activityId: "activity-2026", sourceOrganizationId: clubs[Math.floor(i / 15)]!.id,
    sourceOrganization: clubs[Math.floor(i / 15)]!,
    gender: i % 2 ? "FEMALE" : "MALE", grade: `GRADE_${i % 3 + 1}`, active: true, rowVersion: 1,
  }));
  const eventNames = ["示範團體競賽", "示範創意競賽", "示範舞台挑戰", "示範合作挑戰", "示範接力競賽", "示範成果發表"];
  const events = eventNames.map((name, i) => ({
    id: `event-${i + 1}`, code: `D${i + 1}`, name, displayOrder: i + 1, enabled: true,
    minTeamSize: 2, maxTeamSize: 8, maxTeamsPerRegistration: 2, teamCapacity: i === 0 ? 6 : null,
    allowClub: true, allowLeague: i % 2 === 0, genderRule: null,
    allowedGrades: ["GRADE_1", "GRADE_2", "GRADE_3"], rulesJson: {}, rowVersion: 1,
  }));
  const currentStart = scenario === "meeting" ? date("2026-09-21") : date("2026-09-01");
  const currentEnd = scenario === "registration" ? date("2026-10-10") : date("2026-09-20");
  const activity = {
    id: "activity-2026", code: "DEMO-2026", name: "2026 高康盃｜示範年度", year: 2026,
    timezone: "Asia/Taipei", status: "ACTIVE", stage: scenario === "registration" ? "REGISTRATION" : scenario === "review" ? "BEFORE_LEADER_MEETING" : "LEADER_MEETING",
    stageReason: null, rowVersion: 1, registrationOpensAt: currentStart,
    registrationClosesAt: currentEnd, paymentDueAt: date("2026-10-15"),
    leaderMeetingStartsAt: date("2026-10-18"), leaderMeetingEndsAt: date("2026-10-18"),
    competitionStartsAt: date("2026-10-24"), competitionEndsAt: date("2026-10-25"),
    remittanceInstructions: "展示模式：不接受匯款或任何實際付款。",
  };
  const team = (id: string, ordinal: number, offset: number) => ({
    id, ordinal, rowVersion: 1, admissionStatus: "PENDING",
    members: participants.slice(offset, offset + 3).map(p => ({ participantId: p.id, participant: p })),
  });
  const registration = (club: typeof clubs[number], index: number, status: string) => ({
    id: `registration-${index + 1}`, activityId: activity.id, organizationId: club.id, organization: club,
    leagueId: null, league: null, status, rowVersion: 1, writable: true,
    createdAt: date("2026-09-05"), updatedAt: date("2026-09-10"),
    submittedAt: status === "DRAFT" ? null : date("2026-09-12"),
    confirmedAt: status === "CONFIRMED" ? date("2026-09-15") : null,
    returnReason: status === "RETURNED" ? "展示：請補齊隊伍資料" : null,
    totalRosterAttachment: { id: `attachment-${index + 1}`, originalName: "示範總名單.pdf", mimeType: "application/pdf", sizeBytes: 1000, createdAt: date("2026-09-12") },
    eventEntries: [
      { id: `entry-${index + 1}-1`, eventId: events[0]!.id, event: events[0]!, active: true, source: "REGISTRATION", rowVersion: 1,
        teams: [team(`team-${index + 1}-a`, 1, index * 15), team(`team-${index + 1}-b`, 2, index * 15 + 3)] },
      { id: `entry-${index + 1}-2`, eventId: events[1]!.id, event: events[1]!, active: true, source: "REGISTRATION", rowVersion: 1,
        teams: [team(`team-${index + 1}-c`, 1, index * 15 + 6)] },
    ],
    validation: { blockers: [], warnings: [], participantTimeConflicts: [] },
  });
  const registrations = clubs.map((club, i) => registration(club, i, ["DRAFT", "SUBMITTED", "RETURNED", "CONFIRMED"][i]!));
  for (const entry of registrations[3]!.eventEntries) for (const item of entry.teams) item.admissionStatus = "ADMITTED";
  const leagueRule = { id: "rule-2026", activityId: activity.id, minimumMemberClubs: 2, maximumMemberClubs: 4,
    minimumParticipants: 0, maximumParticipants: 80, lowParticipantQualificationEnabled: true, lowParticipantThreshold: 15,
    genderImbalanceQualificationEnabled: true, minorityGenderRatioPercent: 25, qualificationMode: "ANY",
    singleGenderExceptionEnabled: true, singleGenderExceptionMaximumMemberClubs: 2, singleGenderExceptionMaximumParticipants: 35, rowVersion: 1 };
  const league = { id: "league-1", activityId: activity.id, name: "示範合作聯隊", ownerOrganizationId: clubs[0]!.id,
    status: "ACTIVE", rowVersion: 1,
    members: clubs.slice(0, 2).map((club, i) => ({ id: `league-member-${i + 1}`, organizationId: club.id, organization: club, status: "CONFIRMED" })),
    eligibility: { eligible: true, blockers: [], participantCount: 30, confirmedMemberCount: 2, maximumMemberClubs: 4, maximumParticipants: 80, singleGenderMemberClubs: [] },
  };
  const accounts = demoAccounts.map((a, i) => ({ id: `account-${i + 1}`, email: a.email, displayName: `示範${a.label}`,
    status: "ACTIVE", firstLoginRequired: false, organizationMemberships: i >= 3 ? [{ organizationId: clubs[0]!.id, role: a.role, organization: clubs[0]! }] : [],
    staffAssignments: i < 3 ? [{ role: a.role, revokedAt: null }] : [] }));
  const payments = [{ id: "payment-1", registrationId: registrations[3]!.id, amount: 2500, receivedAmount: 2500,
    status: "CONFIRMED", paidAt: date("2026-09-18"), payerName: "示範付款人", reference: "DEMO-001", rowVersion: 1,
    submittedBy: accounts[3], attachment: null }];
  const feeSchedule = { id: "fee-2026", registrationBaseFee: 1000, participantFee: 100, defaultTeamEntryFee: 300,
    rowVersion: 1, activityRowVersion: 1, remittanceInstructions: activity.remittanceInstructions, feeOverrides: [] };
  const schedules = [{ id: "schedule-1", version: 1, status: "PUBLISHED", rowVersion: 1,
    timeWindows: events.map((event, i) => ({ id: `window-${i + 1}`, eventId: event.id, event, ordinal: 1,
      startAt: new Date(Date.parse("2026-10-24T09:00:00+08:00") + i * 3600000).toISOString(),
      endAt: new Date(Date.parse("2026-10-24T10:00:00+08:00") + i * 3600000).toISOString(),
      venue: `示範場地 ${i % 2 + 1}`, label: null })) }];
  const meeting = { activityId: activity.id, status: scenario === "meeting" ? "ENTRY_OPEN" : "SCHEDULED", rowVersion: 1,
    readiness: "READY_TO_START", confirmedRegistrationCount: 1, leaderMeetingStartsAt: activity.leaderMeetingStartsAt,
    leaderMeetingEndsAt: activity.leaderMeetingEndsAt, competitionStartsAt: activity.competitionStartsAt,
    baseline: null, final: null, reconciliation: { amountDue: 2500, netPaid: 2500, balanceDue: 0, credit: 0 } };
  const legal = ["PRIVACY", "TERMS"].map((kind, i) => ({ id: `demo-policy-${i + 1}`, documentType: kind,
    version: "DEMO-1", title: kind === "PRIVACY" ? "示範個人資料告知" : "示範使用說明",
    bodyMarkdown: "本文件僅供產品介面展示。請勿輸入真實個人資料、帳密或付款資訊。",
    status: "PUBLISHED", publishedAt: date("2026-09-01") }));
  return { version: 1, scenario, onboardingStep: 1, role: null, activity, clubs, accounts, participants, events, schedules,
    registrations, leagues: [league], payments, refunds: [], feeSchedule, leagueRule, meeting, legal };
}

let memory: DemoState | null = null;
let storageWarning = "";
export function warning() { return storageWarning; }
export function state(): DemoState {
  if (memory) return memory;
  memory = initialState();
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      if (raw.length > 200_000) throw new Error("size");
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || (parsed as DemoState).version !== 1 ||
          !["registration", "review", "meeting", "onboarding"].includes((parsed as DemoState).scenario) ||
          !Number.isInteger((parsed as DemoState).onboardingStep) ||
          (parsed as DemoState).onboardingStep < 1 || (parsed as DemoState).onboardingStep > 4 ||
          ((parsed as DemoState).role !== null && !demoAccounts.some(a => a.email === (parsed as DemoState).role)) ||
          !Array.isArray((parsed as DemoState).clubs) || !Array.isArray((parsed as DemoState).registrations) ||
          !Array.isArray((parsed as DemoState).participants) || !Array.isArray((parsed as DemoState).events) ||
          !Array.isArray((parsed as DemoState).payments) || !Array.isArray((parsed as DemoState).legal)) throw new Error("shape");
      memory = parsed as DemoState;
    }
  } catch {
    storageWarning = "展示狀態無法還原，已載入預設虛構資料。";
  }
  return memory;
}
export function save() {
  try {
    const serialized = JSON.stringify(state());
    if (serialized.length > 200_000) throw new Error("size");
    sessionStorage.setItem(key, serialized);
  }
  catch { storageWarning = "瀏覽器未能儲存展示狀態；本分頁仍可繼續操作。"; }
}
export function switchRole(email: DemoEmail | null) { state().role = email; save(); }
export function scenario(name: DemoState["scenario"]) {
  const role = state().role;
  memory = initialState(name);
  memory.role = role;
  save();
}
export function reset() {
  try { sessionStorage.removeItem(key); } catch { /* storage may be unavailable */ }
  memory = initialState();
  storageWarning = "";
}
