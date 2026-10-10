"use client";

import { useEffect, useState } from "react";
import { api } from "./client";
import { Feedback, useOperation } from "./shared";

type Meeting = {
  status: "SCHEDULED" | "ENTRY_OPEN" | "ENTRY_CLOSED_PARTICIPANT_OPEN" | "CLOSED";
  rowVersion: number;
  leaderMeetingStartsAt: string | null;
  leaderMeetingEndsAt: string | null;
  competitionStartsAt: string | null;
  readiness: "NOT_YET_READY" | "READY_TO_START" | "IN_PROGRESS" | "PARTICIPANT_ADJUSTMENT" | "COMPETITION_STARTED" | "CLOSED";
  confirmedRegistrationCount: number;
  baseline?: { amountDue: number; capturedAt: string } | null;
  final?: { amountDue: number; capturedAt: string } | null;
  reconciliation: { amountDue: number; netPaid: number; balanceDue: number; credit: number } | null;
};
type EventAdmission = {
  id: string;
  name: string;
  teamCapacity: number | null;
  admittedCount: number;
  pendingCount: number;
  remainingCapacity: number | null;
  teams: Array<{ id: string; ordinal: number; rowVersion: number; admissionStatus: "PENDING" | "ADMITTED" | "REJECTED"; registrationId: string; unit: string; rosterSize: number }>;
  availableRegistrations: Array<{ id: string; rowVersion: number; unit: string }>;
};

const labels: Record<Meeting["status"], string> = {
  SCHEDULED: "尚未開始",
  ENTRY_OPEN: "賽事項目與隊伍異動開放中",
  ENTRY_CLOSED_PARTICIPANT_OPEN: "賽事項目已結束，選手異動開放中",
  CLOSED: "領隊會議已結束，資料已鎖定",
};

export function LeaderMeetingScreen({ activityId, admin = false, onOpenTeams }: { activityId: string; admin?: boolean; onOpenTeams?: () => void }) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [admissions, setAdmissions] = useState<EventAdmission[]>([]);
  const [addEvent, setAddEvent] = useState<EventAdmission | null>(null);
  const [addRegistrationId, setAddRegistrationId] = useState("");
  const op = useOperation();
  async function load() {
    const [status, eventAdmissions] = await Promise.all([
      api<Meeting>(`activities/${activityId}/leader-meeting`),
      admin ? api<EventAdmission[]>(`activities/${activityId}/event-admissions`) : Promise.resolve([]),
    ]);
    setMeeting(status);
    if (admin) setAdmissions(eventAdmissions);
  }
  useEffect(() => { void load().catch((error) => op.run(() => Promise.reject(error instanceof Error ? error : new Error("無法載入領隊會議狀態")))); }, [activityId]);
  async function transition(path: string, message: string) { await op.run(async () => { await api(`activities/${activityId}/leader-meeting/${path}`, "POST", { reason: message }); await load(); }, message); }
  async function admissionAction(teamId: string, rowVersion: number, action: "admit" | "reject") {
    await op.run(async () => {
      await api(`teams/${teamId}/${action}`, "POST", { rowVersion, reason: action === "admit" ? "領隊會議現場確認加報" : "領隊會議現場不予錄取" });
      await load();
    }, action === "admit" ? "已錄取加報隊伍" : "已拒絕加報隊伍");
  }
  async function addAdmission() {
    if (!addEvent || !addRegistrationId) return;
    const registration = addEvent.availableRegistrations.find((item) => item.id === addRegistrationId);
    if (!registration) return;
    await op.run(async () => {
      await api(`activities/${activityId}/leader-meeting/admissions`, "POST", {
        eventId: addEvent.id,
        registrationId: registration.id,
        reason: "主辦確認現場加報",
      });
      setAddEvent(null);
      setAddRegistrationId("");
      await load();
    }, "已輸入加報，請繼續確認錄取");
  }
  if (!meeting) return <><Feedback {...op} /><section className="card"><p>載入領隊會議狀態…</p></section></>;
  const readinessLabels = { NOT_YET_READY: "尚未到可開始時間", READY_TO_START: "可由主辦單位開始", IN_PROGRESS: "賽事項目與隊伍異動進行中", PARTICIPANT_ADJUSTMENT: "選手異動進行中", COMPETITION_STARTED: "比賽已開始", CLOSED: "已完成並鎖定" } as const;
  const leaderGuidance = meeting.status === "ENTRY_OPEN"
    ? "可加報新賽事、補／換選手，並進行允許的人員調整；領隊會議不提供退賽或移除賽事項目。"
    : meeting.status === "ENTRY_CLOSED_PARTICIPANT_OPEN"
      ? "賽事項目異動已結束，仍可進行允許的人員調整。"
      : meeting.status === "CLOSED"
        ? "領隊會議已完成，最終參賽資料為唯讀。"
        : "會議尚未由主辦單位開始，目前不可異動已確認報名。";
  return (
    <>
      <Feedback {...op} />
      <section className="card meeting-workspace">
        <p className="eyebrow">{admin ? "04 領隊會議" : "03 領隊會議"}</p>
        <h2>{admin ? "領隊會議作業" : "領隊會議"}</h2>
        <p className="status-banner" role="status">目前狀態：{labels[meeting.status]}</p>
        <div className="meeting-meta">
          <p>預定開始：{meeting.leaderMeetingStartsAt ? new Date(meeting.leaderMeetingStartsAt).toLocaleString("zh-TW") : "尚未設定"}</p>
          <p>預定結束：{meeting.leaderMeetingEndsAt ? new Date(meeting.leaderMeetingEndsAt).toLocaleString("zh-TW") : "尚未設定"}</p>
          <p>目前準備狀態：{readinessLabels[meeting.readiness]}</p>
          <p>已確認報名：{meeting.confirmedRegistrationCount} 單位</p>
        </div>
        {admin && (
          <div className="button-group">
            {meeting.status === "SCHEDULED" && meeting.readiness !== "COMPETITION_STARTED" && <button onClick={() => void transition("start", "開始領隊會議")}>開始領隊會議</button>}
            {meeting.status === "ENTRY_OPEN" && <button onClick={() => void transition("close-entry", "結束賽事項目異動")}>結束賽事項目異動</button>}
            {meeting.status === "ENTRY_CLOSED_PARTICIPANT_OPEN" && <button onClick={() => void transition("close", "結束領隊會議")}>結束領隊會議</button>}
          </div>
        )}
        {admin && meeting.status === "ENTRY_OPEN" && (
          <section className="meeting-admission-board">
            <div className="section-heading">
              <div>
                <p className="eyebrow">現場加報確認</p>
                <h3>賽事加報與錄取</h3>
                <p className="muted">展開賽事項目查看目前報名單位、隊伍人數與剩餘名額；只有主辦單位可以在此輸入加報、錄取或拒絕。</p>
              </div>
            </div>
            {admissions.length === 0 ? <p className="empty-note">目前沒有已確認報名的賽事項目。</p> : admissions.map((event) => (
              <details key={event.id} className="meeting-event" open>
                <summary>
                  <strong>{event.name}</strong>
                  <span>
                    {event.teamCapacity === null
                      ? "目前報名 " + (event.admittedCount + event.pendingCount) + " 隊 · 已錄取 " + event.admittedCount + " 隊 · 不限容量"
                      : "目前報名 " + (event.admittedCount + event.pendingCount) + " 隊 · 已錄取 " + event.admittedCount + " / " + event.teamCapacity + " 隊 · 尚餘 " + (event.remainingCapacity ?? 0) + " 隊"}
                    {event.pendingCount ? " · 待處理 " + event.pendingCount + " 隊" : ""}
                  </span>
                </summary>
                <div className="meeting-event-body">
                  <div className="meeting-admission-add">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => { setAddEvent(event); setAddRegistrationId(event.availableRegistrations[0]?.id ?? ""); }}
                      disabled={op.busy || event.availableRegistrations.length === 0 || (event.teamCapacity !== null && event.remainingCapacity === 0)}
                    >
                      {"輸入加報" + (event.availableRegistrations.length ? "（可選 " + event.availableRegistrations.length + " 單位）" : "")}
                    </button>
                    {!event.availableRegistrations.length && <span className="muted">目前沒有可輸入加報的已確認單位。</span>}
                  </div>
                  {event.teams.length === 0 ? <p className="muted">目前尚無社團報名此賽事。</p> : (
                    <ul>
                      {event.teams.map((team) => (
                        <li key={team.id}>
                          <span>
                            <strong>{team.unit}</strong> · {team.ordinal === 1 ? "A 隊" : team.ordinal === 2 ? "B 隊" : "第 " + team.ordinal + " 隊"} · {team.rosterSize} 人 · {team.admissionStatus === "PENDING" ? "待確認" : team.admissionStatus === "ADMITTED" ? "已錄取" : "未錄取"}
                          </span>
                          {team.admissionStatus === "PENDING" && (
                            <span className="button-group">
                              <button onClick={() => void admissionAction(team.id, team.rowVersion, "admit")} disabled={op.busy}>錄取</button>
                              <button className="secondary" onClick={() => void admissionAction(team.id, team.rowVersion, "reject")} disabled={op.busy}>拒絕</button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            ))}
          </section>
        )}
        {!admin && (
          <>
            <p>{leaderGuidance}</p>
            {onOpenTeams && meeting.status !== "SCHEDULED" && meeting.status !== "CLOSED" && <button onClick={onOpenTeams}>在領隊會議中編輯賽事與人力</button>}
          </>
        )}
        {meeting.reconciliation && (
          <>
            <div className="fee-summary-grid">
              <section><h3>目前應繳</h3><strong>NT$ {meeting.reconciliation.amountDue.toLocaleString("zh-TW")}</strong></section>
              <section><h3>已確認付款</h3><strong>NT$ {meeting.reconciliation.netPaid.toLocaleString("zh-TW")}</strong></section>
              <section><h3>待付款</h3><strong>NT$ {meeting.reconciliation.balanceDue.toLocaleString("zh-TW")}</strong></section>
              <section><h3>可退餘額</h3><strong>NT$ {meeting.reconciliation.credit.toLocaleString("zh-TW")}</strong></section>
            </div>
            {meeting.status === "CLOSED" && <p className="muted">退補費請依照活動指定時間與地點，進行現場退補費與領取收據</p>}
          </>
        )}
        {meeting.baseline && <p className="muted">會議基準快照：{new Date(meeting.baseline.capturedAt).toLocaleString("zh-TW")}{typeof meeting.baseline.amountDue === "number" ? " · NT$ " + meeting.baseline.amountDue : ""}</p>}
        {meeting.final && <p className="muted">最終快照已鎖定：{new Date(meeting.final.capturedAt).toLocaleString("zh-TW")}</p>}
      </section>
      {addEvent && (
        <div className="modal-backdrop" role="presentation">
          <section className="card confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="meeting-admission-add-title">
            <h2 id="meeting-admission-add-title">輸入加報：{addEvent.name}</h2>
            <p>請選擇現場確認要加入此賽事的已確認報名單位；新增後會先列為待確認，請再按「錄取」。</p>
            <label>
              報名單位
              <select value={addRegistrationId} onChange={(event) => setAddRegistrationId(event.target.value)}>
                <option value="">請選擇</option>
                {addEvent.availableRegistrations.map((registration) => <option key={registration.id} value={registration.id}>{registration.unit}</option>)}
              </select>
            </label>
            <div className="button-group">
              <button type="button" className="secondary" onClick={() => { setAddEvent(null); setAddRegistrationId(""); }}>取消</button>
              <button type="button" onClick={() => void addAdmission()} disabled={op.busy || !addRegistrationId}>確認輸入加報</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
