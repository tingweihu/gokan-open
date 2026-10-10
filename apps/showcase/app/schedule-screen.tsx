"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "./client";
import { Feedback, useOperation } from "./shared";
import { SharedTimetable, type TimetableItem } from "./timetable";
import { TeamsScreen } from "./teams-screen";

type Event = { id: string; name: string; code: string; minTeamSize?: number | null; maxTeamSize?: number | null; maxTeamsPerRegistration?: number; genderRule?: string | null; allowedGrades?: string[]; rulesJson?: Record<string, unknown> | null; allowClub?: boolean; allowLeague?: boolean };
type Window = { id: string; eventId: string; ordinal: number; event: Event; startAt: string; endAt: string; venue: string | null; label: string | null };
type Schedule = { id: string; version: number; status: string; rowVersion: number; timeWindows: Window[] };
type LeaderItem = { startAt: string; endAt: string; venue: string | null; event: string; unit: string; teams: { ordinal: number; participants: { name: string; sourceClub: string }[] }[] };
type LeaderMembership = { organizationId: string; role?: string; organization: { name: string; activityId: string } };
type LeaderRegistration = { id: string; organizationId: string | null; leagueId?: string | null; rowVersion: number; status: string; submittedAt?: string | null; validation?: { blockers?: { message: string }[] }; eventEntries: { id: string; eventId: string; active: boolean; event?: { name?: string }; teams: { members: { participantId: string; participant?: { name?: string } }[] }[] }[] };
function localTime(value: string) { return new Date(value).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }); }
function minutes(value: string) { const d = new Date(value); return d.getHours() * 60 + d.getMinutes(); }
function day(value: string) { return new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date(value)); }
function eventDetail(event: Event | undefined) {
  if (!event) return "";
  const team = event.minTeamSize !== null && event.minTeamSize !== undefined && event.maxTeamSize !== null && event.maxTeamSize !== undefined && event.minTeamSize === event.maxTeamSize ? `${event.minTeamSize} 人` : event.minTeamSize !== null && event.minTeamSize !== undefined && event.maxTeamSize !== null && event.maxTeamSize !== undefined ? `${event.minTeamSize}–${event.maxTeamSize} 人` : event.minTeamSize !== null && event.minTeamSize !== undefined ? `至少 ${event.minTeamSize} 人` : event.maxTeamSize !== null && event.maxTeamSize !== undefined ? `最多 ${event.maxTeamSize} 人` : "不限人數";
  const rules = event.rulesJson ?? {};
  const genderParts = [typeof rules.exactMaleCount === "number" ? `男性 ${rules.exactMaleCount} 人` : typeof rules.minMaleCount === "number" ? `男性至少 ${rules.minMaleCount} 人` : "", typeof rules.exactFemaleCount === "number" ? `女性 ${rules.exactFemaleCount} 人` : typeof rules.minFemaleCount === "number" ? `女性至少 ${rules.minFemaleCount} 人` : ""].filter(Boolean);
  const gender = genderParts.length ? genderParts.join("、") : event.genderRule === "MALE" ? "男性選手條件" : event.genderRule === "FEMALE" ? "女性選手條件" : "性別不限";
  const grades = event.allowedGrades?.length ? `；${event.allowedGrades.map((grade) => ({ GRADE_1: "高一", GRADE_2: "高二", GRADE_3: "高三" } as Record<string, string>)[grade] ?? grade).join("、")}` : "";
  const units = event.allowClub && event.allowLeague ? "社團／聯隊" : event.allowClub ? "社團" : event.allowLeague ? "聯隊" : "報名單位";
  const limit = event.maxTeamsPerRegistration ? `；每${units}最多 ${event.maxTeamsPerRegistration} 隊` : "";
  return `${team}；${gender}${grades}${limit}`;
}
function registrationParticipationLabel(status: string | undefined, submittedAt?: string | null) {
  if (status === "SUBMITTED") return "報名待審核";
  if (status === "CONFIRMED") return "已確認報名";
  if (status === "RETURNED") return "需修改後重新送出";
  if (status === "DRAFT" && submittedAt) return "選手名單已送出，待送出報名";
  return "已選擇，待送出報名";
}

function LeaderReadOnlyWorkspace({ activityId, memberships, writable, publishedWindows, competitionStartsAt, scheduledEvents, selectedEventIds, leaderItems, leaderRegistration, leaderView, participant, schedulePublished, scheduleError, meetingStatus, meetingMode, onRetry, onToggleEvent, onEventOpen }: {
  activityId: string;
  memberships: LeaderMembership[];
  writable: boolean;
  publishedWindows: Window[];
  competitionStartsAt?: string | null;
  scheduledEvents: Event[];
  selectedEventIds: Set<string>;
  leaderItems: LeaderItem[];
  leaderRegistration: LeaderRegistration | null;
  leaderView: "mine" | "all" | "participant";
  participant: string;
  schedulePublished: boolean;
  scheduleError: string;
  meetingStatus: "SCHEDULED" | "ENTRY_OPEN" | "ENTRY_CLOSED_PARTICIPANT_OPEN" | "CLOSED" | null;
  meetingMode: boolean;
  onRetry: () => void;
  onToggleEvent: (eventId: string, checked: boolean) => Promise<boolean>;
  onEventOpen?: (eventId: string) => void;
}) {
  const [collapsedDays, setCollapsedDays] = useState<Record<string, boolean>>({});
  const [editorEventId, setEditorEventId] = useState<string>();
  const [timetableCollapsed, setTimetableCollapsed] = useState(true);
  const [rosterSubmitBusy, setRosterSubmitBusy] = useState(false);
  const [rosterSubmitError, setRosterSubmitError] = useState("");
  const [rosterSubmitNotice, setRosterSubmitNotice] = useState("");
  const items: TimetableItem[] = leaderView === "all"
    ? publishedWindows.map((window) => {
      const selected = selectedEventIds.has(window.eventId);
      const names = [...new Set([...leaderItems.filter((item) => item.event === window.event.name).flatMap((item) => item.teams.flatMap((team) => team.participants.map((participant) => participant.name))), ...(leaderRegistration?.eventEntries.filter((entry) => entry.eventId === window.eventId && entry.active).flatMap((entry) => entry.teams.flatMap((team) => team.members.map((member) => member.participant?.name).filter((name): name is string => Boolean(name)))) ?? [])])];
      const participantSummary = selected ? `${names.length > 1 ? `${names[0]}等${names.length}人` : names[0] ?? "尚未配置選手"} · ${registrationParticipationLabel(leaderRegistration?.status, leaderRegistration?.submittedAt)}` : "未參賽";
      return { id: window.id, eventId: window.eventId, title: window.event.name, startAt: window.startAt, endAt: window.endAt, venue: window.venue, selected, detail: `${eventDetail(window.event)} · ${participantSummary}` };
    })
    : leaderItems.filter((item) => leaderView !== "participant" || item.teams.some((team) => team.participants.some((p) => p.name === participant))).map((item) => ({ title: item.event, startAt: item.startAt, endAt: item.endAt, venue: item.venue, detail: item.unit }));
  const canSelectEvents = writable && (!leaderRegistration || ["DRAFT", "RETURNED"].includes(leaderRegistration.status) || (leaderRegistration.status === "CONFIRMED" && meetingStatus === "ENTRY_OPEN"));
  const editorWindows = editorEventId ? publishedWindows.filter((window) => window.eventId === editorEventId) : [];
  const overlappingEventIds = new Set(publishedWindows.filter((window) => editorWindows.some((editorWindow) => new Date(window.startAt) < new Date(editorWindow.endAt) && new Date(editorWindow.startAt) < new Date(window.endAt))).map((window) => window.eventId));
  const simultaneousParticipantIds = leaderRegistration?.eventEntries.filter((entry) => entry.active && overlappingEventIds.has(entry.eventId) && entry.eventId !== editorEventId).flatMap((entry) => entry.teams.flatMap((team) => team.members.map((member) => member.participantId))) ?? [];
  const namesForEvent = (event: Event) => [...new Set([...leaderItems.filter((item) => item.event === event.name).flatMap((item) => item.teams.flatMap((team) => team.participants.map((entry) => entry.name))), ...(leaderRegistration?.eventEntries.filter((entry) => entry.eventId === event.id && entry.active).flatMap((entry) => entry.teams.flatMap((team) => team.members.map((member) => member.participant?.name).filter((name): name is string => Boolean(name)))) ?? [])])];
  const eventDays = useMemo(() => {
    const allowed = new Set(scheduledEvents.map((event) => event.id));
    const byDay = new Map<string, Map<string, { startAt: string; endAt: string; events: Event[] }>>();
    for (const window of publishedWindows) {
      if (!allowed.has(window.eventId)) continue;
      const date = day(window.startAt);
      const dayGroups = byDay.get(date) ?? new Map<string, { startAt: string; endAt: string; events: Event[] }>();
      const key = `${window.startAt}|${window.endAt}`;
      const group = dayGroups.get(key) ?? { startAt: window.startAt, endAt: window.endAt, events: [] };
      if (!group.events.some((event) => event.id === window.eventId)) group.events.push(window.event);
      dayGroups.set(key, group);
      byDay.set(date, dayGroups);
    }
    return [...byDay.entries()].map(([date, groups]) => ({ date, groups: [...groups.values()].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()) })).sort((a, b) => new Date(a.groups[0]?.startAt ?? 0).getTime() - new Date(b.groups[0]?.startAt ?? 0).getTime());
  }, [publishedWindows, scheduledEvents]);
  function openEditor(eventId: string) {
    if (onEventOpen) onEventOpen(eventId);
    else setEditorEventId(eventId);
  }
  async function submitRoster() {
    if (!leaderRegistration || rosterSubmitBusy) return;
    setRosterSubmitBusy(true);
    setRosterSubmitError("");
    setRosterSubmitNotice("");
    try {
      const current = await api<LeaderRegistration>(`registrations/${leaderRegistration.id}`);
      const blockers = current.validation?.blockers ?? [];
      if (blockers.length) throw new Error(`選手名單尚有未完成項目：${blockers.map((blocker) => blocker.message).join("；")}`);
      await api(`registrations/${current.id}/roster-submit`, "POST", { rowVersion: current.rowVersion, reason: "送出選手名單" });
      setRosterSubmitNotice("選手名單已送出；報名截止前仍可回到本頁修改。費用頁已同步開放。");
      onRetry();
    } catch (cause) {
      setRosterSubmitError(cause instanceof Error ? cause.message : "選手名單送出失敗，請檢查各賽事隊伍與選手設定。");
    } finally {
      setRosterSubmitBusy(false);
    }
  }
  async function selectAndOpen(event: Event, checked: boolean) {
    if (!checked) return;
    const ok = await onToggleEvent(event.id, true);
    if (ok) openEditor(event.id);
  }
  return <>
    <section className="card schedule-toolbar"><div><p className="eyebrow">{meetingMode ? "04 領隊會議" : "參賽時程"}</p><h2>賽事與人力</h2><p>{meetingMode ? "您正在領隊會議修改資料；系統會依目前會議狀態限制可執行的動作。" : "先勾選要參加的賽事；勾選後即可在下方時程卡開啟隊伍與選手設定。"}</p></div></section>
    {scheduleError ? <section className="card" role="alert"><p>{scheduleError}</p><button className="secondary" onClick={onRetry}>重新整理正式時程</button></section> : !schedulePublished ? <section className="card empty-note"><h2>正式時程尚未發布</h2><p>主辦單位發布正式時程後，這裡會顯示比賽日期、場地與隊伍。</p></section> : <>
      <section className="card leader-event-selection"><div className="section-heading"><div><p className="eyebrow">賽事選擇</p><h2>從正式時程選擇參賽項目</h2><p className="muted">同時段賽事會分組顯示；勾選後點開卡片即可編輯隊伍與選手。</p></div><span className="badge">伺服器即時檢查資格</span></div>{eventDays.length ? <div className="leader-event-days">{eventDays.map(({ date, groups }) => { const collapsed = collapsedDays[date] ?? true; return <section className="leader-event-day" key={date}><button type="button" className="disclosure-button leader-event-day-header" onClick={() => setCollapsedDays((current) => ({ ...current, [date]: !collapsed }))}><span>{date} 賽事</span><span aria-hidden="true">{collapsed ? "展開" : "收合"}</span></button>{!collapsed && <div className="leader-event-groups">{groups.map((group) => <section className="leader-event-group" key={`${group.startAt}-${group.endAt}`}><p className="leader-event-group-time">{localTime(group.startAt)}–{localTime(group.endAt)}</p><div className="leader-event-group-grid">{group.events.map((event) => { const checked = selectedEventIds.has(event.id); const names = namesForEvent(event); const wide = group.events.length === 1 || /唱跳|接力/.test(event.name); return <article className={`leader-event-option${checked ? " is-selected" : ""}${wide ? " is-wide" : ""}`} key={event.id}><input type="checkbox" checked={checked} disabled={!canSelectEvents} onClick={(input) => input.stopPropagation()} onChange={(input) => { void (input.target.checked ? selectAndOpen(event, true) : onToggleEvent(event.id, false)); }} /><button type="button" className="leader-event-card-body" onClick={() => void (checked ? Promise.resolve(openEditor(event.id)) : selectAndOpen(event, true))}><strong>{event.name}</strong><small>{eventDetail(event)} · {event.allowClub && event.allowLeague ? "社團／聯隊" : event.allowLeague ? "聯隊" : "社團"}</small><small className="leader-event-participants">{checked ? `${names.length ? (names.length > 1 ? `${names[0]}等${names.length}人` : names[0]) : "尚未配置選手"} · ${registrationParticipationLabel(leaderRegistration?.status, leaderRegistration?.submittedAt)}` : "未參賽"}</small><span className="leader-event-card-action">{checked ? "編輯隊伍與選手" : "參加此賽事"}</span></button></article>; })}</div></section>)}</div>}</section>})}</div> : <p className="empty-note">目前沒有可選擇的正式賽事。</p>}{meetingMode && meetingStatus === "ENTRY_CLOSED_PARTICIPANT_OPEN" && <p className="muted">目前僅可調整既有隊伍選手，不能新增或撤回賽事項目。</p>}{meetingMode && meetingStatus === "CLOSED" && <p className="muted">領隊會議已結束，資料為唯讀。</p>}</section>
      <section className="card leader-timetable-section"><button type="button" className="disclosure-button leader-event-day-header" onClick={() => setTimetableCollapsed((current) => !current)}><span>參賽時程與人力</span><span aria-hidden="true">{timetableCollapsed ? "展開" : "收合"}</span></button>{!timetableCollapsed && <SharedTimetable items={items} competitionStartsAt={competitionStartsAt} onItemClick={(item) => { if (!item.eventId || !selectedEventIds.has(item.eventId)) return; openEditor(item.eventId); }} emptyText={leaderView === "participant" ? "此篩選目前沒有參賽項目" : leaderView === "mine" ? "目前沒有已報名賽事；切換完整時程查看全部項目。" : "正式時程目前沒有時段。"} />}</section>
      {leaderRegistration && !["SUBMITTED", "CONFIRMED"].includes(leaderRegistration.status) && <section className="card roster-submit-panel"><div className="section-heading"><div><p className="eyebrow">選手名單</p><h2>送出選手名單</h2><p className="muted">填妥所有參賽賽事的隊伍與選手後送出。送出後費用頁才會顯示並連動；報名截止前仍可回到本頁修改。</p></div><span className="badge">{leaderRegistration.submittedAt ? "已送出，可在截止前修改" : "尚未送出"}</span></div>{leaderRegistration.submittedAt && <p className="muted">上次送出：{new Date(leaderRegistration.submittedAt).toLocaleString("zh-TW")}</p>}{rosterSubmitError && <p className="conflict-text" role="alert">{rosterSubmitError}</p>}{rosterSubmitNotice && <p className="success-text" role="status">{rosterSubmitNotice}</p>}<button type="button" className="primary-submit" onClick={() => void submitRoster()} disabled={!writable || rosterSubmitBusy || !leaderRegistration.eventEntries.some((entry) => entry.active)}>{rosterSubmitBusy ? "送出中…" : leaderRegistration.submittedAt ? "更新選手名單" : "送出選手名單"}</button>{!leaderRegistration.eventEntries.some((entry) => entry.active) && <p className="muted">請先選擇至少一項賽事並完成隊伍名單。</p>}{!writable && <p className="muted">此報名單位目前只能查看，無法送出選手名單。</p>}</section>}
      {editorEventId && leaderRegistration && <div className="leader-team-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setEditorEventId(undefined); }}><section className="leader-team-modal card" role="dialog" aria-modal="true" aria-labelledby="leader-team-modal-title"><div className="section-heading"><div><p className="eyebrow">賽事與人力</p><h2 id="leader-team-modal-title">編輯隊伍與選手</h2><p className="muted">{scheduledEvents.find((event) => event.id === editorEventId)?.name ?? "已選賽事"} · 系統會檢查資格、衝突與隊伍規則。</p></div><button type="button" className="secondary" onClick={() => setEditorEventId(undefined)}>關閉</button></div><TeamsScreen activityId={activityId} memberships={memberships.map((membership) => ({ organizationId: membership.organizationId, role: membership.role ?? "LEADER", organization: { name: membership.organization.name } }))} registrationId={leaderRegistration.id} focusEventId={editorEventId} writable={writable} embedded simultaneousParticipantIds={simultaneousParticipantIds} /><div className="leader-team-modal-footer"><p className="muted">選手加入或移除後會立即儲存；取消只會關閉視窗，不會套用尚未加入的勾選。</p><div className="button-group"><button type="button" className="secondary" onClick={() => setEditorEventId(undefined)}>取消</button><button type="button" onClick={() => setEditorEventId(undefined)}>儲存並關閉</button></div></div></section></div>}
    </>}
  </>;
}
export function ScheduleScreen({ activityId, readOnly = false, memberships = [], registrationId, unitKind, writable = true, meetingMode = false, onEventOpen }: { activityId: string; readOnly?: boolean; memberships?: LeaderMembership[]; registrationId?: string; unitKind?: "CLUB" | "LEAGUE"; writable?: boolean; meetingMode?: boolean; onEventOpen?: (eventId: string) => void }) {
  const [events, setEvents] = useState<Event[]>([]); const [schedules, setSchedules] = useState<Schedule[]>([]); const [selected, setSelected] = useState<Schedule | null>(null); const [leaderItems, setLeaderItems] = useState<LeaderItem[]>([]); const [leaderRegistration, setLeaderRegistration] = useState<LeaderRegistration | null>(null);
  const [eventId, setEventId] = useState(""); const [startAt, setStartAt] = useState(""); const [endAt, setEndAt] = useState(""); const [venue, setVenue] = useState(""); const [editing, setEditing] = useState<Window | null>(null); const [impact, setImpact] = useState<{ conflictCount: number } | null>(null); const [mode, setMode] = useState<"visual" | "edit" | "conflict">("visual"); const [leaderView, setLeaderView] = useState<"mine" | "all" | "participant">("all"); const [participant, setParticipant] = useState(""); const [publishedWindows, setPublishedWindows] = useState<Window[]>([]); const [competitionStartsAt, setCompetitionStartsAt] = useState<string | null>(null); const [selectedDay, setSelectedDay] = useState(""); const [schedulePublished, setSchedulePublished] = useState(false); const [scheduleError, setScheduleError] = useState(""); const [meetingStatus, setMeetingStatus] = useState<"SCHEDULED" | "ENTRY_OPEN" | "ENTRY_CLOSED_PARTICIPANT_OPEN" | "CLOSED" | null>(null); const op = useOperation();
  async function load() {
    const [es, ss, activity] = await Promise.all([api<Event[]>(`activities/${activityId}/events`), api<Schedule[]>(`activities/${activityId}/schedules`), api<{ competitionStartsAt: string | null }>(`activities/${activityId}`)]);
    setCompetitionStartsAt(activity.competitionStartsAt);
    setEvents(es); setSchedules(ss);
    const available = readOnly ? ss.filter((s) => s.status === "PUBLISHED") : ss;
    const published = available.find((s) => s.status === "PUBLISHED") ?? null;
    setSchedulePublished(Boolean(published));
    if (readOnly) setPublishedWindows(published?.timeWindows ?? []);
    setSelected((old) => available.find((s) => s.id === old?.id) ?? available[0] ?? null);
    if (readOnly) {
      const meeting = await api<{ status: "SCHEDULED" | "ENTRY_OPEN" | "ENTRY_CLOSED_PARTICIPANT_OPEN" | "CLOSED" }>(`activities/${activityId}/leader-meeting`).catch(() => null);
      setMeetingStatus(meeting?.status ?? null);
      let timetable: { items: LeaderItem[] } = { items: [] };
      try {
        timetable = await api<{ items: LeaderItem[] }>(`activities/${activityId}/leader-timetable${registrationId ? `?registrationId=${encodeURIComponent(registrationId)}` : ""}`);
        setScheduleError("");
      } catch (error) {
        setScheduleError(error instanceof Error ? error.message : "正式時程載入失敗，請重試。");
      }
      setLeaderItems(timetable.items);
      if (registrationId) setLeaderRegistration(await api<LeaderRegistration>(`registrations/${registrationId}`));
      else if (memberships.length) {
        const registrations = await api<{ id: string; organizationId: string | null; leagueId?: string | null }[]>(`activities/${activityId}/registrations`);
        const own = registrations.find((item) => unitKind === "LEAGUE" ? Boolean(item.leagueId) : item.organizationId === memberships[0]?.organizationId);
        setLeaderRegistration(own ? await api<LeaderRegistration>(`registrations/${own.id}`) : null);
      }
    }
  }
  useEffect(() => { void load().catch((error) => setScheduleError(error instanceof Error ? error.message : "正式時程載入失敗，請重試。")); }, [activityId, readOnly, registrationId, unitKind]);
  async function createSchedule() { let created: Schedule | null = null; const ok = await op.run(async () => { created = await api<Schedule>(`activities/${activityId}/schedules`, "POST", {}); }, "時程草稿已建立"); if (ok && created) { const draft = created as Schedule; await load(); setSelected({ ...draft, timeWindows: draft.timeWindows ?? [] }); setEditing(null); setEventId(""); setStartAt(""); setEndAt(""); setVenue(""); setMode("edit"); } }
  function editWindow(window?: Window, preselectedEventId?: string) { if (!selected || selected.status !== "DRAFT") return; setEditing(window ?? null); setEventId(window?.eventId ?? preselectedEventId ?? ""); setStartAt(window ? new Date(new Date(window.startAt).getTime() + 8 * 3600000).toISOString().slice(0, 16) : ""); setEndAt(window ? new Date(new Date(window.endAt).getTime() + 8 * 3600000).toISOString().slice(0, 16) : ""); setVenue(window?.venue ?? ""); setMode("edit"); }
  async function addWindow(e: FormEvent) { e.preventDefault(); if (!selected) return; const payload = { eventId, ordinal: editing?.ordinal ?? selected.timeWindows.length + 1, startAt: new Date(startAt + ":00+08:00").toISOString(), endAt: new Date(endAt + ":00+08:00").toISOString(), venue: venue || null, label: null }; const ok = editing ? await op.run(() => api(`schedules/${selected.id}/windows/${editing.id}`, "PATCH", { ...payload, rowVersion: selected.rowVersion }), "比賽時段已更新") : await op.run(() => api(`schedules/${selected.id}/windows`, "POST", payload), "時程區段已新增"); if (ok) { setEditing(null); setStartAt(""); setEndAt(""); setImpact(null); setMode("visual"); await load(); } }
  async function removeWindow(window: Window) { if (!selected) return; const ok = await op.run(() => api(`schedules/${selected.id}/windows/${window.id}`, "DELETE", { rowVersion: selected.rowVersion }), "時程區段已刪除"); if (ok) { setImpact(null); await load(); } }
  async function analyze() { if (!selected) return; setImpact(await api<{ conflictCount: number }>(`schedules/${selected.id}/impact`)); setMode("conflict"); }
  async function publish() { if (!selected) return; const ok = await op.run(() => api(`schedules/${selected.id}/publish`, "POST", {}), "時程已發布"); if (ok) await load(); }
  async function toggleLeaderEvent(eventId: string, checked: boolean): Promise<boolean> {
    if (!memberships[0] && !registrationId) return false;
    if (!checked && meetingMode && leaderRegistration?.status === "CONFIRMED") {
      setScheduleError("領隊會議期間不能撤回已參賽賽事項目。");
      return false;
    }
    const ok = await op.run(async () => {
      let registration = leaderRegistration;
      if (!registration && unitKind !== "LEAGUE") {
        registration = await api<LeaderRegistration>(`activities/${activityId}/registrations`, "POST", { organizationId: memberships[0]!.organizationId });
        registration = await api<LeaderRegistration>(`registrations/${registration.id}`);
      }
      if (!registration) throw new Error("請先在報名流程選擇聯隊或社團");
      const current = registration.eventEntries.find((entry) => entry.eventId === eventId && entry.active);
      if (checked && !current) {
        await api(`registrations/${registration.id}/events`, "POST", { eventId, rowVersion: registration.rowVersion });
      } else if (!checked && current) {
        if (current.teams.some((team) => team.members.length)) throw new Error("已有選手配置的賽事項目不能直接取消，請先調整隊伍");
        await api(`registrations/${registration.id}/events/${eventId}`, "DELETE", { rowVersion: registration.rowVersion });
      }
      setLeaderRegistration(await api<LeaderRegistration>(`registrations/${registration.id}`));
    }, checked ? "賽事項目已加入報名" : "賽事項目已取消");
    if (!ok) await load();
    return ok;
  }
  const participantNames = [...new Set(leaderItems.flatMap((item) => item.teams.flatMap((team) => team.participants.map((p) => p.name))))];
  const sourceWindows: (Window | LeaderItem)[] = readOnly ? (leaderView === "all" ? publishedWindows : leaderItems.filter((item) => leaderView !== "participant" || item.teams.some((team) => team.participants.some((p) => p.name === participant)))) : selected?.timeWindows ?? [];
  const dates = useMemo(() => [...new Set(sourceWindows.map((w) => day(w.startAt)))], [sourceWindows]);
  const venues = useMemo(() => [...new Set(sourceWindows.map((w) => w.venue || "未指定場地"))], [sourceWindows]);
  const min = sourceWindows.length ? Math.min(...sourceWindows.map((w) => minutes(w.startAt))) : 8 * 60;
  const max = sourceWindows.length ? Math.max(...sourceWindows.map((w) => minutes(w.endAt))) : 20 * 60;
  const range = Math.max(60, max - min);
  // A published two-day schedule is one chronological view; keep both days visible.
  const activeDay = dates.length > 1 ? "" : dates.includes(selectedDay) ? selectedDay : dates[0] || "";
  const windowsForDay = sourceWindows.filter((w) => !activeDay || day(w.startAt) === activeDay);
  const scheduledEvents = [...new Map(publishedWindows.map((window) => [window.eventId, window.event])).values()].filter((event) => unitKind === "LEAGUE" ? event.allowLeague !== false : event.allowClub !== false);
  const selectedEventIds = new Set((leaderRegistration?.eventEntries ?? []).filter((entry) => entry.active).map((entry) => entry.eventId));
  if (readOnly) return <><Feedback {...op} /><LeaderReadOnlyWorkspace activityId={activityId} memberships={memberships} writable={writable} publishedWindows={publishedWindows} competitionStartsAt={competitionStartsAt} scheduledEvents={scheduledEvents} selectedEventIds={selectedEventIds} leaderItems={leaderItems} leaderRegistration={leaderRegistration} leaderView={leaderView} participant={participant} schedulePublished={schedulePublished} scheduleError={scheduleError} meetingStatus={meetingStatus} meetingMode={meetingMode} onRetry={() => void load()} onToggleEvent={toggleLeaderEvent} onEventOpen={onEventOpen} /></>;
  const leaderVisibleWindows: TimetableItem[] = readOnly
    ? (leaderView === "all" ? publishedWindows.map((window) => ({ id: window.id, eventId: window.eventId, title: window.event.name, startAt: window.startAt, endAt: window.endAt, venue: window.venue, detail: `${eventDetail(window.event)} · ${selectedEventIds.has(window.eventId) ? "已參賽" : "未參賽"}` })) : leaderItems.filter((item) => leaderView !== "participant" || item.teams.some((team) => team.participants.some((p) => p.name === participant))).map((item) => ({ title: item.event, startAt: item.startAt, endAt: item.endAt, venue: item.venue, detail: item.unit })) ) : [];
  if (readOnly) return <><Feedback {...op} /><section className="card schedule-toolbar"><div><p className="eyebrow">參賽時程</p><h2>參賽時程</h2><p>完整顯示主辦單位已發布的正式時程；尚未參賽的項目仍保留在時間表中。</p></div><div className="view-tabs" role="tablist"><button className={leaderView === "all" ? "active" : "secondary"} onClick={() => setLeaderView("all")}>完整時程</button><button className={leaderView === "mine" ? "active" : "secondary"} onClick={() => setLeaderView("mine")}>我的賽程</button><button className={leaderView === "participant" ? "active" : "secondary"} onClick={() => setLeaderView("participant")}>依選手查看</button>{leaderView === "participant" && <select aria-label="選擇選手" value={participant} onChange={(event) => setParticipant(event.target.value)}><option value="">選擇選手</option>{participantNames.map((name) => <option key={name}>{name}</option>)}</select>}</div></section>{scheduleError ? <section className="card" role="alert"><p>{scheduleError}</p><button className="secondary" onClick={() => void load()}>重新整理正式時程</button></section> : !schedulePublished ? <section className="card empty-note"><h2>正式時程尚未發布</h2><p>主辦單位發布正式時程後，這裡會顯示比賽日期、場地與隊伍。</p></section> : <><section className="card leader-event-selection"><div className="section-heading"><div><p className="eyebrow">賽事選擇</p><h2>從正式時程選擇參賽項目</h2></div><span className="badge">伺服器即時檢查資格</span></div>{scheduledEvents.length ? <div className="leader-event-list">{scheduledEvents.map((event) => { const window = publishedWindows.find((item) => item.eventId === event.id); const checked = selectedEventIds.has(event.id); return <label className={`leader-event-option${checked ? " is-selected" : ""}`} key={event.id}><input type="checkbox" checked={checked} disabled={op.busy || !writable} onChange={(eventInput) => void toggleLeaderEvent(event.id, eventInput.target.checked)} /><span><strong>{event.name}</strong><small>{window ? `${day(window.startAt)} · ${localTime(window.startAt)}–${localTime(window.endAt)} · ${window.venue || "未指定場地"}` : "時程資料尚未載入"}</small><small>{checked ? "已選擇，可開啟隊伍與選手設定" : "未參賽"}</small></span></label>; })}</div> : <p className="empty-note">目前沒有可選擇的正式賽事。</p>}</section><SharedTimetable items={leaderVisibleWindows} competitionStartsAt={publishedWindows[0]?.startAt} emptyText={leaderView === "participant" ? "此篩選目前沒有參賽項目" : leaderView === "mine" ? "目前沒有已報名賽事；切換完整時程查看全部項目。" : "正式時程目前沒有時段。"} /></>}</>;
  return <><Feedback {...op} /><section className="card schedule-toolbar"><div><p className="eyebrow">時程表</p><h2>{readOnly ? "比賽時程與人力" : "安排比賽時程"}</h2><p>{readOnly ? "已發布的正式時程，支援完整、我的賽程與依選手查看。" : "建立草稿、安排比賽時段、檢查衝突後發布正式時程。"}</p></div><div className="button-group">{!readOnly && <><span className={`badge ${selected?.status === "PUBLISHED" ? "status-confirmed" : "status-draft"}`}>{selected ? (selected.status === "PUBLISHED" ? `目前正式版本 · v${selected.version}` : `目前草稿 · v${selected.version}`) : "尚未建立草稿"}</span><button onClick={() => selected ? (selected.status === "PUBLISHED" ? void createSchedule() : editWindow()) : void createSchedule()} disabled={op.busy}>{selected?.status === "PUBLISHED" ? "從正式版建立新草稿" : "＋編輯賽事時程"}</button><button className="secondary" onClick={() => void analyze()} disabled={!selected || selected.status !== "DRAFT"}>檢查衝突</button><button onClick={() => void publish()} disabled={!selected || selected.status !== "DRAFT" || Boolean(impact?.conflictCount)}>發布時程</button></>}<select aria-label="選擇時程" value={selected?.id ?? ""} onChange={(e) => { const next = schedules.find((s) => s.id === e.target.value) ?? null; setSelected(next); if (readOnly) setPublishedWindows(next?.timeWindows ?? []); setSelectedDay(""); }}>{schedules.filter((s) => !readOnly || s.status === "PUBLISHED").map((s) => <option key={s.id} value={s.id}>{s.status === "PUBLISHED" ? "目前正式版本" : s.status === "DRAFT" ? "目前草稿" : "歷史版本"} · v{s.version}</option>)}</select></div></section>
    {readOnly && <div className="view-tabs" role="tablist"><button className={leaderView === "mine" ? "active" : "secondary"} onClick={() => { setLeaderView("mine"); setSelectedDay(""); }}>我的賽程</button><button className={leaderView === "all" ? "active" : "secondary"} onClick={() => { setLeaderView("all"); setSelectedDay(""); }}>完整時程</button><button className={leaderView === "participant" ? "active" : "secondary"} onClick={() => { setLeaderView("participant"); setSelectedDay(""); }}>依選手查看</button>{leaderView === "participant" && <select aria-label="選擇選手" value={participant} onChange={(e) => setParticipant(e.target.value)}><option value="">選擇選手</option>{participantNames.map((name) => <option key={name}>{name}</option>)}</select>}</div>}
    {readOnly && <section className="card leader-event-selection" aria-labelledby="leader-event-selection-title"><div className="section-heading"><div><p className="eyebrow">報名項目</p><h2 id="leader-event-selection-title">從正式時程選擇參賽項目</h2><p className="muted">勾選後會直接更新目前報名；正式時程只顯示已發布的賽事。</p></div><span className="badge">伺服器即時檢查資格</span></div>{!memberships.length && !registrationId ? <p className="empty-note">目前沒有可操作的社團。</p> : !scheduledEvents.length ? <p className="empty-note">主辦單位尚未發布可選的賽事。</p> : <div className="leader-event-list">{scheduledEvents.map((event) => { const window = publishedWindows.find((item) => item.eventId === event.id); const checked = selectedEventIds.has(event.id); return <label className={`leader-event-option${checked ? " is-selected" : ""}`} key={event.id}><input type="checkbox" checked={checked} disabled={op.busy || !writable} onChange={(e) => void toggleLeaderEvent(event.id, e.target.checked)} /><span><strong>{event.name}</strong><small>{window ? `${day(window.startAt)} · ${localTime(window.startAt)}–${localTime(window.endAt)} · ${window.venue || "未指定場地"}` : "時程資料尚未載入"}</small><small>{eventDetail(event)}</small><button type="button" className="secondary" disabled={!writable} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void (async () => { const ready = checked || await toggleLeaderEvent(event.id, true); if (!ready) return; onEventOpen?.(event.id); })(); }}>{checked ? "編輯隊伍與選手" : "參加此賽事"}</button></span></label>; })}</div>}{!writable && <p className="muted">此報名單位由負責社團管理，您目前只能查看。</p>}{leaderRegistration?.status === "SUBMITTED" && <p className="muted">報名已送出審核，需由主辦單位退回後才能調整。</p>}{leaderRegistration?.status === "CONFIRMED" && <p className="muted">已確認報名的新增與移除，會依領隊會議期間由伺服器判定。</p>}</section>}
    {(!readOnly && mode === "edit") && selected && <form className="card" onSubmit={(e) => void addWindow(e)}><p className="eyebrow">編輯時程</p><h2>{editing ? "編輯賽事時間" : "設定賽事時間"}</h2><div className="formgrid"><label>賽事項目<select value={eventId} onChange={(e) => setEventId(e.target.value)} required><option value="">請選擇</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>日期與開始時間<input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} required /></label><label>結束時間<input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required /></label><label>場地<input value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={120} placeholder="例如：籃球場 A" /></label></div><div className="button-group"><button disabled={op.busy || selected.status !== "DRAFT"}>儲存時段</button><button type="button" className="secondary" onClick={() => { setEditing(null); setMode("visual"); }}>取消</button></div></form>}
    {(!readOnly && selected && mode === "conflict") && <section className="card"><h2>衝突檢查</h2><p role="status" className={impact?.conflictCount ? "conflict-text" : "success-text"}>{impact ? (impact.conflictCount ? `發現 ${impact.conflictCount} 筆選手時程衝突，修正後才能發布。` : "沒有選手時程衝突，可以發布。") : "請先執行衝突檢查。"}</p></section>}
    {sourceWindows.length === 0 ? <section className="card empty-note"><h2>{readOnly ? "正式時程尚未發布" : "尚未建立時程草稿"}</h2><p>{readOnly ? "主辦單位發布正式時程後，這裡會顯示比賽日期、場地與隊伍。" : "建立或選擇草稿後，時程會顯示在這裡。"}</p></section> : <section className="card timetable-board"><div className="section-heading"><div><p className="eyebrow">{readOnly ? "正式時程" : selected?.status === "PUBLISHED" ? "已發布，唯讀" : "草稿時程"}</p><h2>{activeDay}</h2><p className="muted">每個區塊顯示項目、時間、場地與可用的隊伍規則摘要。</p></div><span className={`badge ${readOnly || selected?.status === "PUBLISHED" ? "status-confirmed" : "status-draft"}`}>{readOnly || selected?.status === "PUBLISHED" ? "已發布" : "草稿可繼續調整"}</span></div><div className="timetable-grid"><div className="time-axis"><div className="time-axis-header" aria-hidden="true" /><div className="time-axis-body">{Array.from({ length: Math.floor(range / 60) + 1 }, (_, i) => <span key={i} style={{ top: `${(i * 60 / range) * 100}%` }}>{`${String(Math.floor((min + i * 60) / 60)).padStart(2, "0")}:00`}</span>)}</div></div>{venues.map((venueName) => <div className="venue-lane" key={venueName}><h3>{venueName}</h3><div className="venue-lane-body">{windowsForDay.filter((w) => (w.venue || "未指定場地") === venueName).map((w) => { const top = ((minutes(w.startAt) - min) / range) * 100; const height = Math.max(7, ((minutes(w.endAt) - minutes(w.startAt)) / range) * 100); const title = typeof w.event === "object" ? w.event.name : w.event; const detail = typeof w.event === "object" ? eventDetail(w.event) : ""; const overlaps = windowsForDay.some((other) => other !== w && (other.venue || "未指定場地") === venueName && new Date(w.startAt) < new Date(other.endAt) && new Date(other.startAt) < new Date(w.endAt)); return <article className={`schedule-block${overlaps ? " schedule-conflict" : ""}`} key={(w as Window).id ?? `${w.startAt}-${title}`} style={{ top: `${top}%`, height: `${height}%` }}><strong>{title}</strong><span>{dates.length > 1 ? `${day(w.startAt)} · ` : ""}{localTime(w.startAt)}–{localTime(w.endAt)}</span>{detail && <small>{detail}</small>}{overlaps && <small>時間重疊，請檢查</small>}{"unit" in w && <small>{w.unit}</small>}{!readOnly && "id" in w && selected?.status === "DRAFT" && <span className="schedule-actions"><button className="secondary" onClick={() => editWindow(w)}>修改</button><button className="secondary" onClick={() => void removeWindow(w)}>刪除</button></span>}</article>; })}</div></div>)}</div><div className="mobile-timetable">{windowsForDay.map((w) => { const title = typeof w.event === "object" ? w.event.name : w.event; const detail = typeof w.event === "object" ? eventDetail(w.event) : ""; return <article key={`${w.startAt}-${title}`}><strong>{title}</strong><span>{day(w.startAt)} · {localTime(w.startAt)}–{localTime(w.endAt)}</span><small>{w.venue || "未指定場地"}{detail ? ` · ${detail}` : ""}{"unit" in w ? ` · ${w.unit}` : ""}</small></article>; })}</div></section>}
  </>;
}
