"use client";
import { useEffect, useState } from "react";
import { api } from "./client";
import { Feedback, useOperation } from "./shared";

type UnitKind = "CLUB" | "LEAGUE";
type Club = { organizationId: string; organization: { name: string }; role: string };
type Participant = { id: string; name: string; active: boolean; gender?: "MALE" | "FEMALE"; grade?: "GRADE_1" | "GRADE_2" | "GRADE_3"; sourceOrganization?: { name: string } };
type Team = { id: string; ordinal: number; rowVersion: number; admissionStatus?: "PENDING" | "ADMITTED" | "REJECTED"; members: { participantId: string; participant: Participant }[] };
type Entry = { id: string; eventId: string; active: boolean; rowVersion: number; source?: string; event: { name: string; minTeamSize?: number | null; maxTeamSize?: number | null; maxTeamsPerRegistration?: number; genderRule?: "MALE" | "FEMALE" | null; allowedGrades?: string[]; rulesJson?: Record<string, unknown> | null; allowClub?: boolean; allowLeague?: boolean }; teams: Team[] };
type Registration = { id: string; organizationId: string | null; leagueId: string | null; rowVersion: number; status: string; writable?: boolean; eventEntries: Entry[] };
type RegistrationSuggestion = {
  outcome: "COMPLETE" | "NO_FEASIBLE_SOLUTION" | "OPTIMIZATION_LIMIT_REACHED";
  registrationId: string; fingerprint: string; registrationRowVersion: number; rowVersion: number; entryRowVersions: Record<string, number>; teamRowVersions: Record<string, number>; participantRowVersions: Record<string, number>;
  participants: { id: string; name: string; gender: string; grade: string; sourceOrganizationId: string; sourceOrganization?: { name: string } }[];
  events: { entryId: string; eventId: string; eventName: string; requiredParticipants: number; assignedParticipants: number; complete: boolean; willCreateTeamA: boolean; blockers: string[]; lockedParticipantIds: string[]; suggestedParticipantIds: string[]; teamAssignments: { teamId: string; ordinal: number; admissionStatus: "PENDING" | "ADMITTED"; willCreateTeamA: boolean; participantIds: string[]; addedParticipantIds: string[]; lockedParticipantIds: string[]; complete: boolean }[]; windows: { startAt: string; endAt: string }[] }[];
  blockers: string[]; warnings: string[]; activeParticipantCount: number; assignedParticipantCount: number; idleParticipantIds: string[]; preservedParticipantIds: string[];
  timeSlices: { startAt: string; endAt: string; events: { eventId: string; eventName: string; participantCount: number }[]; simultaneousDemand: number; simultaneousAssigned: number; restingParticipantIds: string[] }[];
  search: { nodesVisited: number; nodeBudget: number }; changes: boolean;
};

type MeetingStatus = "SCHEDULED" | "ENTRY_OPEN" | "ENTRY_CLOSED_PARTICIPANT_OPEN" | "CLOSED";
function teamStatusLabel(registrationStatus: string, admissionStatus?: Team["admissionStatus"]) {
  if (["DRAFT", "SUBMITTED", "RETURNED"].includes(registrationStatus) && admissionStatus === "ADMITTED") return "報名待審核";
  return admissionStatus === "ADMITTED" ? "已錄取" : admissionStatus === "REJECTED" ? "未錄取" : "待主辦錄取";
}

function hasGenderCompositionRules(event: Entry["event"]) {
  const rules = event.rulesJson ?? {};
  return ["exactMaleCount", "exactFemaleCount", "minMaleCount", "minFemaleCount"].some((key) => typeof rules[key] === "number");
}

function genderConstraintText(event: Entry["event"]) {
  const rules = event.rulesJson ?? {};
  const parts: string[] = [];
  if (typeof rules.exactMaleCount === "number") parts.push(`男性 ${rules.exactMaleCount} 人`);
  else if (typeof rules.minMaleCount === "number") parts.push(`男性至少 ${rules.minMaleCount} 人`);
  if (typeof rules.exactFemaleCount === "number") parts.push(`女性 ${rules.exactFemaleCount} 人`);
  else if (typeof rules.minFemaleCount === "number") parts.push(`女性至少 ${rules.minFemaleCount} 人`);
  if (parts.length) return parts.join("、");
  if (event.genderRule === "MALE") return "男性選手條件";
  if (event.genderRule === "FEMALE") return "女性選手條件";
  return "性別不限";
}

function gradeConstraintText(event: Entry["event"]) {
  const rules = event.rulesJson ?? {};
  const parts: string[] = [];
  if (typeof rules.minGradeOneCount === "number") parts.push(`高一至少 ${rules.minGradeOneCount} 人`);
  if (typeof rules.minGradeOneRatio === "number") parts.push(`高一比例至少 ${rules.minGradeOneRatio}%`);
  return parts.join("、");
}

function selectionCompositionBlockers(event: Entry["event"], participants: Participant[]) {
  const rules = event.rulesJson ?? {};
  const male = participants.filter((participant) => participant.gender === "MALE").length;
  const female = participants.filter((participant) => participant.gender === "FEMALE").length;
  const blockers: string[] = [];
  if (typeof rules.exactMaleCount === "number" && male > rules.exactMaleCount) blockers.push(`男性選手最多只能選 ${rules.exactMaleCount} 人`);
  if (typeof rules.exactFemaleCount === "number" && female > rules.exactFemaleCount) blockers.push(`女性選手最多只能選 ${rules.exactFemaleCount} 人`);
  if (event.maxTeamSize != null && participants.length > event.maxTeamSize) blockers.push(`每隊最多 ${event.maxTeamSize} 人`);
  return blockers;
}

function gradeLabel(grade?: Participant["grade"]) {
  return grade === "GRADE_1" ? "高一" : grade === "GRADE_2" ? "高二" : grade === "GRADE_3" ? "高三" : "年級未設定";
}

function genderLabel(gender?: Participant["gender"]) {
  return gender === "MALE" ? "男" : gender === "FEMALE" ? "女" : "性別未設定";
}

function ParticipantPicker({ participants, existingParticipants = [], simultaneousParticipantIds, selectedParticipantIds, onlyUnscheduled, onOnlyUnscheduledChange, onSelectionChange, onActivate, onAdd, onRemoveExisting, onClearSelection, disabled, event }: {
  participants: Participant[];
  existingParticipants?: Participant[];
  simultaneousParticipantIds: string[];
  selectedParticipantIds: string[];
  onlyUnscheduled: boolean;
  onOnlyUnscheduledChange: (value: boolean) => void;
  onSelectionChange: (ids: string[]) => void;
  onActivate: () => void;
  onAdd: () => void;
  onRemoveExisting: (id: string) => void;
  onClearSelection: () => void;
  disabled: boolean;
  event: Entry["event"];
}) {
  const simultaneous = new Set(simultaneousParticipantIds);
  const visible = onlyUnscheduled ? participants.filter((participant) => !simultaneous.has(participant.id)) : participants;
  const selected = new Set(selectedParticipantIds);
  const allSelected = visible.length > 0 && visible.every((participant) => selected.has(participant.id));
  const genderText = genderConstraintText(event);
  const gradeText = event.allowedGrades?.length ? event.allowedGrades.map((grade) => gradeLabel(grade as Participant["grade"])).join("、") : "不限年級";
  const sizeText = event.maxTeamSize == null ? "人數不限" : `每隊最多 ${event.maxTeamSize} 人`;
  const gradeConstraint = gradeConstraintText(event);
  const rules = event.rulesJson ?? {};
  const minGradeOneCount = typeof rules.minGradeOneCount === "number" ? rules.minGradeOneCount : null;
  const minGradeOneRatio = typeof rules.minGradeOneRatio === "number" ? rules.minGradeOneRatio : null;
  const selectedVisibleCount = selectedParticipantIds.filter((id) => visible.some((participant) => participant.id === id)).length;
  const selectedParticipants = [...existingParticipants, ...participants.filter((participant) => selected.has(participant.id))].filter((participant, index, all) => all.findIndex((item) => item.id === participant.id) === index);
  const maleCount = selectedParticipants.filter((participant) => participant.gender === "MALE").length;
  const femaleCount = selectedParticipants.filter((participant) => participant.gender === "FEMALE").length;
  const grade1Count = selectedParticipants.filter((participant) => participant.grade === "GRADE_1").length;
  const grade2Count = selectedParticipants.filter((participant) => participant.grade === "GRADE_2").length;
  const grade3Count = selectedParticipants.filter((participant) => participant.grade === "GRADE_3").length;
  const groups = [
    { key: "grade1-male", title: "高一男", items: visible.filter((participant) => participant.grade === "GRADE_1" && participant.gender === "MALE") },
    { key: "grade1-female", title: "高一女", items: visible.filter((participant) => participant.grade === "GRADE_1" && participant.gender === "FEMALE") },
    { key: "grade2-male", title: "高二男", items: visible.filter((participant) => participant.grade === "GRADE_2" && participant.gender === "MALE") },
    { key: "grade2-female", title: "高二女", items: visible.filter((participant) => participant.grade === "GRADE_2" && participant.gender === "FEMALE") },
    { key: "other", title: "其他年級／性別", items: visible.filter((participant) => !((participant.grade === "GRADE_1" || participant.grade === "GRADE_2") && (participant.gender === "MALE" || participant.gender === "FEMALE"))) },
  ].filter((group) => group.items.length > 0);
  return <section className="participant-picker" onFocus={onActivate}>
    <div className="participant-picker-toolbar">
      <div><strong>符合資格的選手</strong><span className="muted participant-picker-constraints">{genderText} · {gradeText} · {sizeText}{gradeConstraint ? ` · ${gradeConstraint}` : ""}</span></div>
      <span className="muted">可直接勾選名單，一次加入隊伍</span>
      <label className="check participant-filter"><input type="checkbox" checked={onlyUnscheduled} onChange={(input) => { onActivate(); const next = input.target.checked; onOnlyUnscheduledChange(next); if (next) onSelectionChange(selectedParticipantIds.filter((id) => !simultaneous.has(id))); }} />只顯示同時段尚未參賽</label>
    </div>
    <div className="participant-picker-stats" role="status" aria-live="polite"><strong>目前已選 {selectedParticipants.length} 人</strong><span>男性 {maleCount}</span><span>女性 {femaleCount}</span><span>高一 {grade1Count}{minGradeOneCount !== null ? ` / 至少 ${minGradeOneCount}` : ""}{minGradeOneRatio !== null ? `（至少 ${minGradeOneRatio}%）` : ""}</span><span>高二 {grade2Count}</span><span>高三 {grade3Count}</span></div>
    {existingParticipants.length > 0 && <div className="participant-picker-selected" role="status"><strong>已加入本隊（點選 × 可移除）：</strong><div className="participant-picker-chips">{existingParticipants.map((participant) => <span className="participant-chip" key={participant.id}>{participant.name}<button type="button" className="participant-chip-remove" aria-label={`移除${participant.name}`} onClick={() => onRemoveExisting(participant.id)} disabled={disabled}>×</button></span>)}</div></div>}
    <div className="participant-picker-actions"><button type="button" className="secondary" onClick={() => { onActivate(); onSelectionChange([...new Set([...selectedParticipantIds.filter((id) => visible.some((participant) => participant.id === id)), ...visible.map((participant) => participant.id)])]); }} disabled={disabled || !visible.length || allSelected}>全選符合資格</button><button type="button" className="tertiary" onClick={() => { onActivate(); onSelectionChange([]); }} disabled={disabled || !selectedParticipantIds.length}>清除選取</button><button type="button" className="tertiary" title="清除本隊已加入的所有選手與目前勾選，完成後可重新填寫" onClick={onClearSelection} disabled={disabled || (!existingParticipants.length && !selectedParticipantIds.length)}>清除重填</button><button type="button" onClick={onAdd} disabled={disabled || !selectedVisibleCount}>加入已選選手（{selectedVisibleCount}）</button></div>
    {visible.length ? <div className="participant-picker-groups">{groups.map((group) => <section className="participant-picker-group" key={group.key}><h4>{group.title}<span>{group.items.length} 人</span></h4><div className="participant-picker-grid">{group.items.map((participant) => <label className={`participant-picker-option${selected.has(participant.id) ? " is-selected" : ""}`} key={participant.id}><input type="checkbox" checked={selected.has(participant.id)} onChange={(input) => { onActivate(); onSelectionChange(input.target.checked ? [...new Set([...selectedParticipantIds, participant.id])] : selectedParticipantIds.filter((id) => id !== participant.id)); }} /><span><strong>{participant.name}</strong><small>{genderLabel(participant.gender)} · {gradeLabel(participant.grade)}{participant.sourceOrganization?.name ? ` · ${participant.sourceOrganization.name}` : ""}</small></span></label>)}</div></section>)}</div> : <p className="empty-note">目前沒有符合條件且可用的選手。</p>}
  </section>;
}

export function TeamsScreen({ activityId, memberships, focusEventId, registrationId, unitKind, unitLabel, writable = true, embedded = false, excludeParticipantIds = [], simultaneousParticipantIds = [] }: { activityId: string; memberships: Club[]; focusEventId?: string; registrationId?: string; unitKind?: UnitKind; unitLabel?: string; writable?: boolean; embedded?: boolean; excludeParticipantIds?: string[]; simultaneousParticipantIds?: string[] }) {
  const [registration, setRegistration] = useState<Registration | null>(null); const [events, setEvents] = useState<{ id: string; name: string; enabled: boolean; allowClub?: boolean; allowLeague?: boolean; minTeamSize?: number | null; maxTeamsPerRegistration?: number }[]>([]); const [participants, setParticipants] = useState<Participant[]>([]); const [clubId, setClubId] = useState(memberships[0]?.organizationId ?? ""); const [eventId, setEventId] = useState(""); const [teamId, setTeamId] = useState(""); const [participantId, setParticipantId] = useState(""); const [stage, setStage] = useState(""); const [meetingStatus, setMeetingStatus] = useState<MeetingStatus | null>(null); const [replacementId, setReplacementId] = useState(""); const [bulkTeamId, setBulkTeamId] = useState(""); const [bulkParticipantIds, setBulkParticipantIds] = useState<string[]>([]); const [onlyUnscheduled, setOnlyUnscheduled] = useState(false); const [showAllEntries, setShowAllEntries] = useState(false); const [suggestion, setSuggestion] = useState<{ entryId: string; entryRowVersion: number; teamRowVersions: Record<string, number>; assignments: { teamId: string; participantIds: string[] }[]; blockers: string[]; preservedParticipantIds: string[]; changes: boolean } | null>(null); const [registrationSuggestion, setRegistrationSuggestion] = useState<RegistrationSuggestion | null>(null); const [suggestionView, setSuggestionView] = useState<"events" | "time">("events"); const op = useOperation();
  async function load() {
    const [activity, meeting] = await Promise.all([api<{ stage: string }>("activities/" + activityId), api<{ status: MeetingStatus }>("activities/" + activityId + "/leader-meeting").catch(() => null)]); setStage(activity.stage); setMeetingStatus(meeting?.status ?? null);
    const listed = await api<typeof events>("activities/" + activityId + "/events"); setEvents(Array.isArray(listed) ? listed : []);
    let current = registration;
    if (registrationId) current = await api<Registration>("registrations/" + registrationId);
    else if (!current && clubId) { const registrations = await api<Registration[]>("activities/" + activityId + "/registrations"); const existing = registrations.find((item) => item.organizationId === clubId); if (existing) current = await api<Registration>("registrations/" + existing.id); }
    if (current) setRegistration(current);
    const effectiveClub = current?.organizationId ?? (unitKind === "CLUB" ? clubId : "");
    if (effectiveClub) { const roster = await api<{ participants: Participant[] }>("clubs/" + effectiveClub + "/roster"); setParticipants(roster.participants.filter((p) => p.active)); }
    else if (current?.leagueId) { const roster = await api<Participant[]>("leagues/" + current.leagueId + "/participants"); setParticipants(roster.filter((p) => p.active)); }
  }
  useEffect(() => { void load().catch(() => undefined); }, [activityId, registrationId, clubId, unitKind]);
  async function openRegistration() { if (!clubId) return; let createdId = ""; const result = await op.run(async () => { const created = await api<Registration>("activities/" + activityId + "/registrations", "POST", { organizationId: clubId }); createdId = created.id; }, "報名已建立"); if (result && createdId) { const [created, roster] = await Promise.all([api<Registration>("registrations/" + createdId), api<{ participants: Participant[] }>("clubs/" + clubId + "/roster")]); setRegistration({ ...created, writable: true }); setParticipants(roster.participants.filter((participant) => participant.active)); } }
  async function addEntry() { if (!registration) return; const result = await op.run(() => api("registrations/" + registration.id + "/events", "POST", { eventId, rowVersion: registration.rowVersion }), "賽事報名已加入"); if (result) { setShowAllEntries(true); setRegistration(await api<Registration>("registrations/" + registration.id)); } }
  async function addTeam(entry: Entry) { const result = await op.run(async () => { const latest = await api<Registration>("registrations/" + registration!.id); const current = latest.eventEntries.find((item) => item.id === entry.id); if (!current) throw new Error("找不到賽事報名"); await api<Team>("event-entries/" + entry.id + "/teams", "POST", { ordinal: current.teams.length + 1, rowVersion: current.rowVersion }); }, "隊伍已建立"); if (result) setRegistration(await api<Registration>("registrations/" + registration!.id)); }
  async function addMember(team: Team) { const result = await op.run(() => api("teams/" + team.id + "/members", "POST", { participantId, rowVersion: team.rowVersion }), "選手已加入隊伍"); if (result) setRegistration(await api<Registration>("registrations/" + registration!.id)); }
  async function removeMember(team: Team, id: string) {
    if (!registration) return;
    const result = await op.run(async () => {
      const latest = await api<Registration>("registrations/" + registration.id);
      const entry = latest.eventEntries.find((item) => item.teams.some((candidate) => candidate.id === team.id));
      const freshTeam = entry?.teams.find((candidate) => candidate.id === team.id);
      if (!freshTeam) throw new Error("找不到隊伍");
      await api("teams/" + team.id + "/members/" + id, "DELETE", { rowVersion: freshTeam.rowVersion });
    }, "選手已移除");
    if (result) {
      setBulkParticipantIds((ids) => ids.filter((participantId) => participantId !== id));
      setRegistration(await api<Registration>("registrations/" + registration.id));
    }
  }
  async function clearTeam(team: Team) {
    if (!registration || typeof window === "undefined") return;
    if (!window.confirm("確定要清除本隊目前的所有選手嗎？清除後可重新選擇名單。")) return;
    const result = await op.run(async () => {
      let current = await api<Registration>("registrations/" + registration.id);
      while (true) {
        const entry = current.eventEntries.find((item) => item.teams.some((candidate) => candidate.id === team.id));
        const freshTeam = entry?.teams.find((candidate) => candidate.id === team.id);
        if (!freshTeam || !freshTeam.members.length) break;
        const member = freshTeam.members[0];
        if (!member) break;
        await api("teams/" + team.id + "/members/" + member.participantId, "DELETE", { rowVersion: freshTeam.rowVersion });
        current = await api<Registration>("registrations/" + registration.id);
      }
      setRegistration(current);
    }, "隊伍已清除，請重新選擇選手");
    if (result) { setBulkParticipantIds([]); setBulkTeamId(""); }
  }
  async function addBulkMembers(team: Team) {
    if (!registration || !bulkParticipantIds.length) return;
    const ids = [...bulkParticipantIds];
    const result = await op.run(async () => {
      let current = await api<Registration>("registrations/" + registration.id);
      const initialEntry = current.eventEntries.find((item) => item.teams.some((candidate) => candidate.id === team.id));
      const initialTeam = initialEntry?.teams.find((candidate) => candidate.id === team.id);
      if (!initialEntry || !initialTeam) throw new Error("找不到隊伍");
      const allowedIds = new Set(selectableParticipants(initialEntry).map((participant) => participant.id));
      const invalidIds = ids.filter((id) => !allowedIds.has(id));
      if (invalidIds.length) throw new Error(`${initialEntry.event.name}：有 ${invalidIds.length} 位選手已不符合性別、年級、同時段或報名單位條件，請重新選擇。`);
      if (initialEntry.event.maxTeamSize !== null && initialEntry.event.maxTeamSize !== undefined && initialTeam.members.length + ids.length > initialEntry.event.maxTeamSize) {
        throw new Error(`${initialEntry.event.name}：每隊最多 ${initialEntry.event.maxTeamSize} 人，目前已有 ${initialTeam.members.length} 人，請減少選擇。`);
      }
      const selectedParticipants = [...initialTeam.members.map((member) => member.participant), ...ids.map((id) => participants.find((participant) => participant.id === id)).filter((participant): participant is Participant => Boolean(participant))];
      const compositionBlockers = selectionCompositionBlockers(initialEntry.event, selectedParticipants);
      if (compositionBlockers.length) throw new Error(`${initialEntry.event.name}：${compositionBlockers.join("；")}，請重新選擇。`);
      for (const id of ids) {
        const entry = current.eventEntries.find((item) => item.teams.some((candidate) => candidate.id === team.id));
        const freshTeam = entry?.teams.find((candidate) => candidate.id === team.id);
        if (!freshTeam) throw new Error("找不到隊伍");
        await api("teams/" + team.id + "/members", "POST", { participantId: id, rowVersion: freshTeam.rowVersion });
        current = await api<Registration>("registrations/" + registration.id);
      }
      setRegistration(current);
    }, "已加入選取的選手");
    if (result) { setBulkParticipantIds([]); setBulkTeamId(""); }
  }
  async function moveMember(from: Team, to: Team, id: string) { const result = await op.run(async () => { const latest = await api<Registration>("registrations/" + registration!.id); const entry = latest.eventEntries.find((item) => item.id === from.id || item.teams.some((team) => team.id === from.id)); const freshFrom = entry?.teams.find((team) => team.id === from.id); const freshTo = entry?.teams.find((team) => team.id === to.id); if (!freshFrom || !freshTo) throw new Error("找不到隊伍"); await api("teams/move-member", "POST", { participantId: id, fromTeamId: freshFrom.id, toTeamId: freshTo.id, fromRowVersion: freshFrom.rowVersion, toRowVersion: freshTo.rowVersion }); }, "選手已移動"); if (result) setRegistration(await api<Registration>("registrations/" + registration!.id)); }
  async function replaceMember(team: Team, id: string) { if (!registration || !replacementId) return; const result = await op.run(() => api("teams/replace-member", "POST", { teamId: team.id, participantId: id, replacementParticipantId: replacementId, rowVersion: team.rowVersion }), "選手已替換"); if (result) { setReplacementId(""); setRegistration(await api<Registration>("registrations/" + registration.id)); } }
  async function suggest(entry: Entry) { const result = await op.run(async () => setSuggestion(await api("event-entries/" + entry.id + "/roster-suggestion", "POST", {})), "已產生配置建議"); if (!result) setSuggestion(null); }
  async function applySuggestion() { if (!suggestion || !registration) return; const result = await op.run(() => api("event-entries/" + suggestion.entryId + "/roster-suggestion/apply", "POST", { rowVersion: suggestion.entryRowVersion, teamRowVersions: suggestion.teamRowVersions }), "配置已套用"); if (result) { setSuggestion(null); setRegistration(await api<Registration>("registrations/" + registration.id)); } }
  async function suggestRegistration() { if (!registration) return; const result = await op.run(async () => setRegistrationSuggestion(await api<RegistrationSuggestion>("registrations/" + registration.id + "/roster-suggestion", "POST", {})), "已產生全賽事建議"); if (!result) setRegistrationSuggestion(null); }
  async function applyRegistrationSuggestion() { if (!registration || !registrationSuggestion) return; const result = await op.run(() => api("registrations/" + registration.id + "/roster-suggestion/apply", "POST", { registrationRowVersion: registrationSuggestion.registrationRowVersion, fingerprint: registrationSuggestion.fingerprint, entryRowVersions: registrationSuggestion.entryRowVersions, teamRowVersions: registrationSuggestion.teamRowVersions, participantRowVersions: registrationSuggestion.participantRowVersions }), "全賽事配置已套用"); if (result) { setRegistrationSuggestion(null); setRegistration(await api<Registration>("registrations/" + registration.id)); } }
  const suggestionParticipantNames = (ids: string[]) => ids.map((id) => registrationSuggestion?.participants.find((participant) => participant.id === id)?.name ?? id);
  const registrationStageEditable = ["REGISTRATION", "LEADER_MEETING"].includes(stage) || Boolean(registration?.status === "RETURNED" && stage === "BEFORE_LEADER_MEETING");
  const initialEditable = Boolean(registration && ["DRAFT", "RETURNED"].includes(registration.status) && registrationStageEditable);
  const optimizerAvailable = false;
  const confirmedMeeting = registration?.status === "CONFIRMED";
  const canAddEvent = Boolean(writable && (initialEditable || (confirmedMeeting && meetingStatus === "ENTRY_OPEN")));
  const canCreateTeam = canAddEvent;
  const canAdjustMembers = Boolean(writable && (initialEditable || (confirmedMeeting && (meetingStatus === "ENTRY_OPEN" || meetingStatus === "ENTRY_CLOSED_PARTICIPANT_OPEN"))));
  const stageText = meetingStatus === "ENTRY_OPEN" ? "領隊會議已開始：可新增賽事項目與調整人員；既有賽事項目不得撤回。" : meetingStatus === "ENTRY_CLOSED_PARTICIPANT_OPEN" ? "賽事項目異動已結束：不可新增或撤回賽事，仍可調整既有隊伍人員。" : meetingStatus === "CLOSED" ? "領隊會議已結束：正式資料已鎖定，僅供查看。" : stage === "LEADER_MEETING" ? "已到會議時間，主辦尚未開始領隊會議；資料仍維持鎖定。" : stage === "BEFORE_LEADER_MEETING" ? "領隊會議尚未開始：已確認報名目前不可調整。" : "目前作業階段：" + stage;
  const visibleEvents = events.filter((event) => registration?.organizationId ? event.allowClub !== false : event.allowLeague !== false);
  const meetingShowsAllEntries = registration?.status === "CONFIRMED" && meetingStatus === "ENTRY_OPEN";
  const visibleEntries = (registration?.eventEntries ?? []).filter((entry) => entry.active && (!focusEventId || showAllEntries || meetingShowsAllEntries || entry.source === "LEADER_MEETING" || entry.eventId === focusEventId));
  const excludedParticipantSet = new Set(excludeParticipantIds);
  const participantMatchesEvent = (participant: Participant, entry: Entry) => ((!hasGenderCompositionRules(entry.event) && !entry.event.genderRule) || hasGenderCompositionRules(entry.event) || participant.gender === entry.event.genderRule) && (!(entry.event.allowedGrades?.length) || Boolean(participant.grade && entry.event.allowedGrades.includes(participant.grade)));
  const selectableParticipants = (entry: Entry) => participants.filter((participant) => !excludedParticipantSet.has(participant.id) && participantMatchesEvent(participant, entry) && !(entry.teams ?? []).some((team) => team.members.some((member) => member.participantId === participant.id)));
  return <><Feedback {...op} />{!embedded && <section className="card"><h2>隊伍報名</h2><p role="status">{stageText}</p>{registrationId ? <p className="muted">報名單位：{unitKind === "LEAGUE" ? "聯隊" : "社團"} · {unitLabel}</p> : <label>社團<select value={clubId} onChange={(e) => setClubId(e.target.value)}>{memberships.map((m) => <option key={m.organizationId} value={m.organizationId}>{m.organization.name} · {m.role === "LEADER" ? "領隊" : "副領隊"}</option>)}</select></label>}{!registration && !registrationId ? <button onClick={() => void openRegistration()} disabled={op.busy || !clubId}>建立本年度報名</button> : !registration ? <p>尚未建立此報名單位的報名。</p> : <p>本年度報名已建立，請在下方選擇賽事項目。</p>}</section>}
  {registration && <>{!embedded && <section className="card"><h2>選擇賽事項目</h2><select value={eventId} onChange={(e) => setEventId(e.target.value)} disabled={!canAddEvent}><option value="">請選擇</option>{visibleEvents.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select>{canAddEvent && <button onClick={() => void addEntry()} disabled={op.busy || !eventId}>加入報名</button>}{!writable && <p className="muted">此聯隊由負責社團管理，您目前只能查看。</p>}</section>}{optimizerAvailable && <section className="card smart-roster-card"><div className="section-heading"><div><p className="eyebrow">規則運算</p><h2>智慧選手配置</h2><p className="muted">系統依本年度賽事限制、正式時程與目前選手名單，自動產生整份報名的建議配置。</p></div><span className="badge">不使用生成式 AI</span></div><button onClick={() => void suggestRegistration()} disabled={op.busy || !registration.eventEntries.some((entry) => entry.active)}>產生全賽事建議</button>{registrationSuggestion && <div className="smart-roster-preview"><p role="status"><strong>智慧配置結果</strong> · {registrationSuggestion.events.filter((entry) => entry.complete).length} / {registrationSuggestion.events.length} 項賽事可完整配置</p><p>有效選手 {registrationSuggestion.activeParticipantCount} · 至少上場一次 {registrationSuggestion.assignedParticipantCount} · 完全未安排 {registrationSuggestion.idleParticipantIds.length}</p><div className="button-group"><button className={suggestionView === "events" ? "secondary" : "tertiary"} onClick={() => setSuggestionView("events")}>依賽事查看</button><button className={suggestionView === "time" ? "secondary" : "tertiary"} onClick={() => setSuggestionView("time")}>依時段查看</button></div>{suggestionView === "events" ? <div className="smart-roster-events">{registrationSuggestion.events.map((item) => <article className="notice" key={item.entryId}><strong>{item.eventName}{item.willCreateTeamA ? " · 將建立 A 隊" : ""}</strong><p>{item.complete ? `✓ ${item.assignedParticipants} / ${item.requiredParticipants} 人符合` : "配置未完成"}</p>{item.blockers.map((blocker) => <p role="alert" key={blocker}>⚠ {blocker}</p>)}{item.teamAssignments.map((team) => <p key={team.teamId}>{team.ordinal === 1 ? "A 隊" : team.ordinal === 2 ? "B 隊" : `第 ${team.ordinal} 隊`}{team.admissionStatus === "PENDING" ? "（待主辦錄取）" : ""}：{suggestionParticipantNames(team.participantIds).join("、")}{team.lockedParticipantIds.length > 0 && <small> · 手動保留 {team.lockedParticipantIds.length} 位</small>}</p>)}</article>)}</div> : <div className="smart-roster-time">{registrationSuggestion.timeSlices.map((slice) => <article className="notice" key={`${slice.startAt}-${slice.endAt}`}><strong>{new Date(slice.startAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false })}–{new Date(slice.endAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false })}</strong>{slice.events.map((item) => <p key={item.eventId}>{item.eventName} · {item.participantCount} 人</p>)}<p>同時上場 {slice.simultaneousAssigned} · 本時段休息 {suggestionParticipantNames(slice.restingParticipantIds).join("、") || "無"}</p></article>)}</div>}{registrationSuggestion.blockers.map((blocker) => <p role="alert" key={blocker}>⚠ {blocker}</p>)}{registrationSuggestion.outcome === "COMPLETE" && registrationSuggestion.changes ? <button onClick={() => void applyRegistrationSuggestion()} disabled={op.busy}>套用全部配置</button> : <p className="muted">{registrationSuggestion.outcome === "COMPLETE" ? "目前配置已符合展示條件，無需套用。" : "請先修正阻擋項目，再重新產生建議。"}</p>}<p className="muted">預覽不會修改資料；套用時只更新本分頁的虛構配置；正式規則仍以產品後端為準。</p></div>}</section>}{visibleEntries.map((entry) => <section className="card" key={entry.id}><h2>{entry.event.name}</h2><p className="muted">第一隊優先；第二隊依報名狀況遞補，建立不等於第二隊可參賽。</p>{optimizerAvailable && <button className="secondary" onClick={() => void suggest(entry)}>一鍵建議配置</button>}{suggestion?.entryId === entry.id && <div className="notice"><p><strong>已產生建議</strong> · {suggestion.blockers.length ? "尚有問題" : "符合規則"}</p><p>建議保留 {suggestion.preservedParticipantIds.length} 位既有配置。</p>{suggestion.blockers.map((blocker) => <p key={blocker}>⚠ {blocker}</p>)}{suggestion.blockers.length ? <p role="alert">目前條件不足，請先修正問題。</p> : suggestion.changes ? <button onClick={() => void applySuggestion()} disabled={op.busy}>套用建議</button> : <p className="muted">目前配置已符合展示條件，無需套用。</p>}<p>套用時只更新本分頁的虛構隊伍。</p></div>}{(() => { const primary = entry.teams.find((team) => team.ordinal === 1); const canSecond = entry.teams.length === 1 && (entry.event.maxTeamsPerRegistration ?? 1) > 1; const available = participants.length - (primary?.members.length ?? 0); const minimum = entry.event.minTeamSize ?? 0; const primaryComplete = !primary || primary.members.length >= minimum; return <>{canSecond && !primaryComplete && <p className="muted">請先完成 A 隊至少 {minimum} 人，再建立 B 隊。</p>}{canSecond && primaryComplete && minimum > available && <p className="muted">B 隊目前另有 {available} 名可用選手，至少需要 {minimum} 人，暫時無法建立第二隊。</p>}{canCreateTeam && <button onClick={() => void addTeam(entry)} disabled={op.busy || (canSecond && (!primaryComplete || minimum > available))}>{entry.teams.length === 0 ? "建立隊伍" : canSecond ? "建立第二隊" : "新增隊伍"}</button>}</>; })()}{entry.teams.map((team) => { const teamWritable = canAdjustMembers && team.admissionStatus !== "REJECTED"; return <div className="card" key={team.id}><strong>{team.ordinal === 1 ? "A 隊" : team.ordinal === 2 ? "B 隊" : "第 " + team.ordinal + " 隊"}</strong><span className={"badge " + (team.admissionStatus === "ADMITTED" ? "status-confirmed" : "status-draft")}>{teamStatusLabel(registration.status, team.admissionStatus)}</span><select className="legacy-team-picker" aria-label="選擇選手" value={teamId === team.id ? participantId : ""} onChange={(e) => { setTeamId(team.id); setParticipantId(e.target.value); }} disabled={!teamWritable}><option value="">選擇名單選手</option>{participants.filter((p) => !(entry.teams ?? []).some((t) => t.members.some((m) => m.participantId === p.id))).map((p) => <option key={p.id} value={p.id}>{p.name}{p.sourceOrganization?.name ? " · " + p.sourceOrganization.name : ""}</option>)}</select><button className="legacy-team-picker" onClick={() => void addMember(team)} disabled={op.busy || !teamWritable || teamId !== team.id || !participantId}>加入隊伍</button>{embedded && <ParticipantPicker participants={selectableParticipants(entry)} existingParticipants={team.members.map((member) => member.participant)} event={entry.event} simultaneousParticipantIds={simultaneousParticipantIds} selectedParticipantIds={bulkTeamId === team.id ? bulkParticipantIds : []} onlyUnscheduled={bulkTeamId === team.id && onlyUnscheduled} onOnlyUnscheduledChange={(value) => { setBulkTeamId(team.id); setOnlyUnscheduled(value); }} onSelectionChange={(ids) => { setBulkTeamId(team.id); setBulkParticipantIds(ids); }} onActivate={() => { if (bulkTeamId !== team.id) { setBulkTeamId(team.id); setBulkParticipantIds([]); } }} onRemoveExisting={(id) => void removeMember(team, id)} onClearSelection={() => void clearTeam(team)} onAdd={() => void addBulkMembers(team)} disabled={op.busy || !teamWritable} />}<ul>{team.members.map((member) => <li key={member.participantId}>{member.participant.name}{entry.teams.length > 1 && entry.teams.filter((target) => target.id !== team.id && target.admissionStatus !== "REJECTED").map((target) => <button className="secondary" key={target.id} onClick={() => void moveMember(team, target, member.participantId)} disabled={!teamWritable}>移至 {target.ordinal === 2 ? "B 隊" : "A 隊"}</button>)}{teamWritable && (embedded ? <button type="button" className="participant-remove" aria-label={`移除${member.participant.name}`} onClick={() => void removeMember(team, member.participantId)} disabled={op.busy}>×</button> : <><select aria-label="選擇替補選手" value={replacementId} onChange={(e) => setReplacementId(e.target.value)}><option value="">選擇替補選手</option>{participants.filter((p) => p.id !== member.participantId && !(entry.teams ?? []).some((t) => t.members.some((tm) => tm.participantId === p.id))).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="secondary" onClick={() => void replaceMember(team, member.participantId)} disabled={op.busy || !replacementId}>替換選手</button></>)}</li>)}</ul></div>; })}</section>)}</>}
  </>;
}
