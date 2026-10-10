"use client";
import { demoNow } from "./demo-state";
import { useEffect, useMemo, useState } from "react";
import { api } from "./client";
import { Feedback, useOperation } from "./shared";
import { ScheduleScreen } from "./schedule-screen";
import { SharedTimetable } from "./timetable";

type Event = {
  id: string;
  code: string;
  name: string;
  displayOrder: number;
  enabled: boolean;
  minTeamSize: number | null;
  maxTeamSize: number | null;
  maxTeamsPerRegistration: number;
  teamCapacity: number | null;
  allowClub: boolean;
  allowLeague: boolean;
  genderRule: string | null;
  allowedGrades: string[];
  rulesJson?: Record<string, unknown>;
  rowVersion: number;
};
type ScheduleWindow = { id: string; eventId: string; ordinal: number; startAt: string; endAt: string; venue: string | null; label: string | null; event?: Event };
type Schedule = { id: string; version: number; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; rowVersion: number; timeWindows: ScheduleWindow[] };
type Activity = { registrationOpensAt?: string | null; competitionStartsAt?: string | null };
type BuilderState = { locked: boolean; registrationStarted: boolean; meaningfulDependency: boolean };
type DayChoice = "1" | "2" | "both";
type EventForm = { code: string; name: string; displayOrder: number; enabled: boolean; minTeamSize: number | null; maxTeamSize: number | null; maxTeamsPerRegistration: number; teamCapacity: number | null; allowClub: boolean; allowLeague: boolean; genderRule: string; allowedGrades: string[]; rulesJson: Record<string, unknown> };
type Impact = { conflictCount: number; conflicts?: { requestedEventId: string; conflictingEventId: string }[] };

const blank: EventForm = { code: "", name: "", displayOrder: 1, enabled: true, minTeamSize: 1, maxTeamSize: 12, maxTeamsPerRegistration: 1, teamCapacity: null, allowClub: true, allowLeague: true, genderRule: "", allowedGrades: [], rulesJson: {} };

function registrationUnitLabel(event: Pick<Event, "allowClub" | "allowLeague">) {
  if (event.allowClub && event.allowLeague) return "社團／聯隊";
  if (event.allowClub) return "社團";
  if (event.allowLeague) return "聯隊";
  return "報名單位";
}
function eventDetail(event: Event) {
  const size = event.minTeamSize !== null && event.maxTeamSize !== null && event.minTeamSize === event.maxTeamSize
    ? `${event.minTeamSize} 人`
    : event.minTeamSize !== null && event.maxTeamSize !== null
      ? `${event.minTeamSize}–${event.maxTeamSize} 人`
      : event.minTeamSize !== null ? `至少 ${event.minTeamSize} 人` : event.maxTeamSize !== null ? `最多 ${event.maxTeamSize} 人` : "不限人數";
  const quota = event.teamCapacity === null ? "不限隊" : `${event.teamCapacity} 隊`;
  const second = event.maxTeamsPerRegistration > 1 ? "可第二隊" : "單隊";
  return `${size} · ${quota} · ${second} · ${registrationUnitLabel(event)}`;
}
function localTime(value: string) { return new Date(value).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" }); }
function venueClass(venue: string | null) {
  const value = (venue ?? "未指定場地").trim();
  if (value.includes("操場")) return "venue-mint";
  if (value.includes("籃球")) return "venue-yellow";
  if (value.includes("排球")) return "venue-pink";
  const hash = [...value].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 0);
  return `venue-fallback-${hash % 3}`;
}
function minutes(value: string) { const d = new Date(value); const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }).formatToParts(d); return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0); }
function dateKey(value: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(value)); }
function dayLabel(day: 1 | 2, competitionStartsAt?: string | null) {
  if (!competitionStartsAt) return `第${day}天`;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(competitionStartsAt));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const date = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + day - 1, 0, 0));
  return `第${day}天 · ${new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", weekday: "short", timeZone: "Asia/Taipei" }).format(date)}`;
}
function windowDay(window: ScheduleWindow, competitionStartsAt?: string | null): 1 | 2 {
  if ((window.label ?? "").includes("2") || (window.label ?? "").includes("第二")) return 2;
  if (!competitionStartsAt) return 1;
  const first = dateKey(competitionStartsAt);
  return dateKey(window.startAt) === first ? 1 : 2;
}
function scheduleSummary(eventId: string, schedules: Schedule[]) {
  const published = schedules.find((schedule) => schedule.status === "PUBLISHED");
  const draft = schedules.find((schedule) => schedule.status === "DRAFT");
  const source = draft ?? published;
  const windows = source?.timeWindows.filter((window) => window.eventId === eventId) ?? [];
  return windows;
}

export function OrganizerTimetable({ events, schedule, competitionStartsAt, conflictEventIds, onEventOpen }: { events: Event[]; schedule: Schedule | null; competitionStartsAt?: string | null; conflictEventIds: Set<string>; onEventOpen: (event: Event) => void }) {
  const eventMap = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const windows = schedule?.timeWindows ?? [];
  return <div className="organizer-timetable">{([1, 2] as const).map((dayNumber) => {
    const dayWindows = windows.filter((window) => windowDay(window, competitionStartsAt) === dayNumber);
    const venues = [...new Set(dayWindows.map((window) => window.venue || "未指定場地"))];
    const min = dayWindows.length ? Math.min(...dayWindows.map((window) => minutes(window.startAt))) : 8 * 60;
    const max = dayWindows.length ? Math.max(...dayWindows.map((window) => minutes(window.endAt))) : 20 * 60;
    const range = Math.max(60, max - min);
    const renderCard = (window: ScheduleWindow, compact = false) => {
      const event = window.event ?? eventMap.get(window.eventId);
      if (!event) return null;
      const conflict = conflictEventIds.has(event.id);
      return <button type="button" className={`event-timetable-card ${venueClass(window.venue)}${!compact ? " schedule-block" : ""}${conflict ? " schedule-conflict" : ""}`} key={`${compact ? "mobile-" : ""}${window.id}`} onClick={() => onEventOpen(event)}><strong>{event.name}</strong><span>{localTime(window.startAt)}–{localTime(window.endAt)}</span><small>{window.venue || "未指定場地"} · {eventDetail(event)}</small>{conflict && <small className="conflict-text">時間衝突，請檢查</small>}</button>;
    };
    const timetableHeight = Math.max(500, range * 1.5);
    return <section className="organizer-day card" key={dayNumber}><div className="section-heading"><div><p className="eyebrow">比賽日</p><h2>{dayLabel(dayNumber, competitionStartsAt)}</h2></div><span className="badge">{dayWindows.length} 項</span></div>{!dayWindows.length ? <p className="empty-note">尚未建立這一天的賽事，請新增比賽或帶入 2025 比賽資訊。</p> : <><div className="timetable-grid"><div className="time-axis"><div className="time-axis-header" aria-hidden="true" /><div className="time-axis-body" style={{ minHeight: timetableHeight }}>{Array.from({ length: Math.floor(range / 60) + 1 }, (_, index) => <span key={index} style={{ top: `${(index * 60 / range) * 100}%` }}>{`${String(Math.floor((min + index * 60) / 60)).padStart(2, "0")}:00`}</span>)}</div></div>{venues.map((venueName) => <div className="venue-lane" key={venueName}><h3>{venueName}</h3><div className="venue-lane-body" style={{ minHeight: timetableHeight }}>{dayWindows.filter((window) => (window.venue || "未指定場地") === venueName).sort((left, right) => minutes(left.startAt) - minutes(right.startAt)).map((window) => { const top = ((minutes(window.startAt) - min) / range) * 100; const height = Math.max(8, ((minutes(window.endAt) - minutes(window.startAt)) / range) * 100); const card = renderCard(window); return card && <span key={window.id} className="event-timetable-position" style={{ top: `${top}%`, height: `${height}%` }}>{card}</span>; })}</div></div>)}</div><div className="mobile-timetable organizer-mobile-timetable">{dayWindows.slice().sort((left, right) => minutes(left.startAt) - minutes(right.startAt)).map((window) => renderCard(window, true))}</div></>}</section>;
  })}</div>;
}

export function CompetitionScreen({ activityId, admin }: { activityId: string; admin: boolean }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [builderState, setBuilderState] = useState<BuilderState | null>(null);
  const [form, setForm] = useState<EventForm>(blank);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [competitionStartsAt, setCompetitionStartsAt] = useState<string | null>(null);
  const [dayChoice, setDayChoice] = useState<DayChoice>("1");
  const [day1Start, setDay1Start] = useState("09:00");
  const [day1End, setDay1End] = useState("11:00");
  const [day1Venue, setDay1Venue] = useState("");
  const [day2Start, setDay2Start] = useState("09:00");
  const [day2End, setDay2End] = useState("11:00");
  const [day2Venue, setDay2Venue] = useState("");
  const [impact, setImpact] = useState<Impact | null>(null);
  const op = useOperation();

  async function load() {
    const [listedEvents, listedSchedules, currentActivity, currentBuilderState] = await Promise.all([
      api<Event[]>(`activities/${activityId}/events`),
      api<Schedule[]>(`activities/${activityId}/schedules`),
      api<Activity>(`activities/${activityId}`),
      admin ? api<BuilderState>(`activities/${activityId}/competition-builder-state`) : Promise.resolve<BuilderState | null>(null),
    ]);
    setEvents(listedEvents); setSchedules(listedSchedules); setActivity(currentActivity); setBuilderState(currentBuilderState); setCompetitionStartsAt(currentActivity.competitionStartsAt ?? null);
    const draft = listedSchedules.find((schedule) => schedule.status === "DRAFT");
    if (draft) void api<Impact>(`schedules/${draft.id}/impact`).then(setImpact).catch(() => setImpact(null)); else setImpact(null);
  }
  useEffect(() => { void load().catch(() => undefined); }, [activityId, admin]);

  const draft = schedules.find((schedule) => schedule.status === "DRAFT") ?? null;
  const published = schedules.find((schedule) => schedule.status === "PUBLISHED") ?? null;
  const sourceSchedule = draft ?? published;
  const publicationState = draft && published ? "已有未發布修改" : published ? "已發布" : "尚未發布";
  const registrationStarted = Boolean(activity?.registrationOpensAt && new Date(demoNow()) >= new Date(activity.registrationOpensAt));
  const locked = !admin || Boolean(builderState?.locked);
  const conflictEventIds = useMemo(() => new Set((impact?.conflicts ?? []).flatMap((conflict) => [conflict.requestedEventId, conflict.conflictingEventId])), [impact]);

  function toIso(day: 1 | 2, clock: string) {
    if (!competitionStartsAt || !clock) return null;
    const [hours = 0, minutesValue = 0] = clock.split(":").map(Number);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(competitionStartsAt));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return new Date(Date.UTC(get("year"), get("month") - 1, get("day") + day - 1, hours - 8, minutesValue)).toISOString();
  }
  function configuredWindows() {
    const result: { ordinal: number; startAt: string; endAt: string; venue: string | null; label: string }[] = [];
    if (dayChoice === "1" || dayChoice === "both") { const startAt = toIso(1, day1Start); const endAt = toIso(1, day1End); if (startAt && endAt) result.push({ ordinal: 1, startAt, endAt, venue: day1Venue || null, label: dayLabel(1, competitionStartsAt) }); }
    if (dayChoice === "2" || dayChoice === "both") { const startAt = toIso(2, day2Start); const endAt = toIso(2, day2End); if (startAt && endAt) result.push({ ordinal: 2, startAt, endAt, venue: day2Venue || null, label: dayLabel(2, competitionStartsAt) }); }
    return result;
  }
  function openEditor(event?: Event) {
    setEditingEvent(event ?? null); setForm(event ? { code: event.code, name: event.name, displayOrder: event.displayOrder, enabled: event.enabled, minTeamSize: event.minTeamSize, maxTeamSize: event.maxTeamSize, maxTeamsPerRegistration: event.maxTeamsPerRegistration, teamCapacity: event.teamCapacity, allowClub: event.allowClub, allowLeague: event.allowLeague, genderRule: event.genderRule ?? "", allowedGrades: event.allowedGrades, rulesJson: event.rulesJson ?? {} } : blank);
    const windows = event ? scheduleSummary(event.id, schedules) : [];
    const first = windows[0]; const second = windows[1];
    const clock = (value: string | undefined) => value ? new Date(value).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }) : "09:00";
    if (first) { setDay1Start(clock(first.startAt)); setDay1End(clock(first.endAt)); setDay1Venue(first.venue ?? ""); }
    if (second) { setDay2Start(clock(second.startAt)); setDay2End(clock(second.endAt)); setDay2Venue(second.venue ?? ""); setDayChoice("both"); }
    else if (first) setDayChoice(windowDay(first, competitionStartsAt) === 1 ? "1" : "2");
    else setDayChoice("1");
    setShowEditor(true);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (locked) return;
    const windows = configuredWindows();
    const payload = { ...form, code: form.code || undefined, genderRule: form.genderRule || null, windows };
    const ok = await op.run(() => editingEvent ? api(`activities/${activityId}/events/${editingEvent.id}`, "PATCH", { ...payload, rowVersion: editingEvent.rowVersion, reason: "更新賽事項目設定" }) : api(`activities/${activityId}/events`, "POST", payload), editingEvent ? "賽事項目已更新" : "賽事項目已建立");
    if (ok) { setShowEditor(false); setEditingEvent(null); await load(); }
  }
  async function removeEvent(event: Event) {
    if (locked) return;
    const ok = await op.run(() => api(`activities/${activityId}/events/${event.id}`, "DELETE", { reason: "刪除年度賽事項目" }), "賽事項目已刪除");
    if (ok) { setShowEditor(false); setEditingEvent(null); await load(); }
  }
  async function applyTemplate() {
    if (locked) return;
    const ok = await op.run(() => api(`activities/${activityId}/event-template/2025/apply`, "POST", { template: "2025", confirm: true }), "2025 賽事項目已建立");
    if (ok) await load();
  }
  async function checkConflicts() {
    if (!draft) { setImpact({ conflictCount: 0, conflicts: [] }); return; }
    let result: Impact | null = null;
    const ok = await op.run(async () => { result = await api<Impact>(`schedules/${draft.id}/impact`); }, "時間衝突檢查完成");
    if (ok && result) setImpact(result);
  }
  async function publishFinal() {
    if (!draft || impact?.conflictCount) return;
    const ok = await op.run(() => api(`schedules/${draft.id}/publish`, "POST", {}), "最終比賽項目清單已發布");
    if (ok) await load();
  }

  if (!admin) return <ScheduleScreen activityId={activityId} readOnly />;
  return <>
    <Feedback {...op} />
    <section className="card competition-builder-header"><div className="section-heading"><div><p className="eyebrow">年度設定</p><h2>賽事項目設定</h2><p className="muted">同一個雙日時程就是本年度的賽事清單；點選賽事卡片即可編輯。</p></div><div className="builder-summary"><span className="badge">賽事 {events.length} 項</span><span className={`badge${impact?.conflictCount ? " status-error" : ""}`}>時間衝突 {impact?.conflictCount ?? 0} 筆</span><span className="badge">{publicationState}</span></div></div>{locked && <p className="lock-banner" role="status">{registrationStarted ? "報名已開始，賽事項目設定已鎖定。" : "已有報名資料，賽事項目設定已鎖定。"}</p>}<div className="builder-actions"><div className="builder-actions-main"><button className="secondary" onClick={() => openEditor()} disabled={locked}>{events.length ? "＋新增比賽" : "＋建立賽事項目"}</button><span className="template-action"><button className="tertiary" onClick={() => void applyTemplate()} disabled={locked || events.length > 0}>帶入 2025 比賽資訊</button>{events.length > 0 && <small className="template-locked-help">已有賽事項目時無法帶入範本。</small>}</span>{events.length > 0 && <button className="tertiary" onClick={() => void checkConflicts()} disabled={!draft}>檢查時間衝突</button>}</div>{events.length > 0 && <button className="builder-publish" onClick={() => void publishFinal()} disabled={!draft || Boolean(impact?.conflictCount)}>發布最終比賽項目清單</button>}</div></section>
    <SharedTimetable items={(sourceSchedule?.timeWindows ?? []).map((window) => ({ id: window.id, eventId: window.eventId, title: window.event?.name ?? events.find((event) => event.id === window.eventId)?.name ?? "賽事項目", startAt: window.startAt, endAt: window.endAt, venue: window.venue, detail: window.event ? eventDetail(window.event) : events.find((event) => event.id === window.eventId) ? eventDetail(events.find((event) => event.id === window.eventId)!) : "", day: windowDay(window, competitionStartsAt), conflict: conflictEventIds.has(window.eventId) }))} competitionStartsAt={competitionStartsAt} onItemClick={(item) => { const event = events.find((candidate) => candidate.id === item.eventId); if (event) openEditor(event); }} emptyText="尚未建立任何賽事時段。" />
    {showEditor && <div className="modal-backdrop"><form className="card event-editor-modal" onSubmit={(event) => void submit(event)}><div className="section-heading"><div><p className="eyebrow">賽事項目設定</p><h2>{editingEvent ? "編輯比賽" : "新增比賽"}</h2></div><button type="button" className="secondary" onClick={() => setShowEditor(false)}>關閉</button></div><div className="event-form-grid"><label className="event-name-field">名稱<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={120} /></label><label>顯示順序<input type="number" value={form.displayOrder} onChange={(event) => setForm({ ...form, displayOrder: Number(event.target.value) })} min={0} /></label><label>每隊最少人數<input type="number" value={form.minTeamSize ?? ""} onChange={(event) => setForm({ ...form, minTeamSize: event.target.value ? Number(event.target.value) : null })} min={1} /></label><label>每隊最多人數<input type="number" value={form.maxTeamSize ?? ""} onChange={(event) => setForm({ ...form, maxTeamSize: event.target.value ? Number(event.target.value) : null })} min={1} placeholder="不限" /></label><label>報名隊伍總上限<input type="number" value={form.teamCapacity ?? ""} onChange={(event) => setForm({ ...form, teamCapacity: event.target.value ? Number(event.target.value) : null })} min={1} placeholder="不限" /></label><label>開放第二隊<select value={form.maxTeamsPerRegistration} onChange={(event) => setForm({ ...form, maxTeamsPerRegistration: Number(event.target.value) })}><option value={1}>不可</option><option value={2}>可</option></select></label><label className="checkbox-label league-field"><input type="checkbox" checked={form.allowLeague} onChange={(event) => setForm({ ...form, allowLeague: event.target.checked })} /> 開放聯隊</label><label className="checkbox-label"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> {form.enabled ? "啟用賽事項目" : "停用賽事項目"}</label><label className="day-field">比賽日<select value={dayChoice} onChange={(event) => setDayChoice(event.target.value as DayChoice)}><option value="1">第一天</option><option value="2">第二天</option><option value="both">兩天都有</option></select></label>{(dayChoice === "1" || dayChoice === "both") && <fieldset><legend>第一天</legend><div className="time-fields"><label>開始時間<input type="time" value={day1Start} onChange={(event) => setDay1Start(event.target.value)} required /></label><label>結束時間<input type="time" value={day1End} onChange={(event) => setDay1End(event.target.value)} required /></label></div><label>場地<input value={day1Venue} onChange={(event) => setDay1Venue(event.target.value)} maxLength={120} /></label></fieldset>}{(dayChoice === "2" || dayChoice === "both") && <fieldset><legend>第二天</legend><div className="time-fields"><label>開始時間<input type="time" value={day2Start} onChange={(event) => setDay2Start(event.target.value)} required /></label><label>結束時間<input type="time" value={day2End} onChange={(event) => setDay2End(event.target.value)} required /></label></div><label>場地<input value={day2Venue} onChange={(event) => setDay2Venue(event.target.value)} maxLength={120} /></label></fieldset>}<details className="advanced-rules">
  <summary>進階隊伍限制</summary>
  <div className="formgrid advanced-rules-grid">
    <label>性別篩選（無人數規則時）<select value={form.genderRule} onChange={(event) => setForm({ ...form, genderRule: event.target.value })}><option value="">不限</option><option value="MALE">僅男性選手</option><option value="FEMALE">僅女性選手</option></select></label>
    <div className="gender-rule-row">
      <label>男生至少<input type="number" min={0} value={typeof form.rulesJson.minMaleCount === "number" ? String(form.rulesJson.minMaleCount) : ""} onChange={(event) => setForm({ ...form, rulesJson: { ...form.rulesJson, minMaleCount: event.target.value ? Number(event.target.value) : undefined } })} /></label>
      <label>女生至少<input type="number" min={0} value={typeof form.rulesJson.minFemaleCount === "number" ? String(form.rulesJson.minFemaleCount) : ""} onChange={(event) => setForm({ ...form, rulesJson: { ...form.rulesJson, minFemaleCount: event.target.value ? Number(event.target.value) : undefined } })} /></label>
    </div>
    <label>高一至少<input type="number" min={0} value={typeof form.rulesJson.minGradeOneCount === "number" ? String(form.rulesJson.minGradeOneCount) : ""} onChange={(event) => setForm({ ...form, rulesJson: { ...form.rulesJson, minGradeOneCount: event.target.value ? Number(event.target.value) : undefined } })} /></label>
  </div>
</details></div><div className="button-group editor-actions"><button disabled={locked || op.busy}>{editingEvent ? "儲存比賽" : "建立比賽"}</button>{editingEvent && <button type="button" className="secondary" onClick={() => void removeEvent(editingEvent)} disabled={locked || op.busy}>刪除</button>}<button type="button" className="secondary" onClick={() => setShowEditor(false)}>取消</button></div></form></div>}
  </>;
}
