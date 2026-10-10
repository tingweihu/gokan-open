"use client";

import { useCallback, useEffect, useState } from "react";
import { api, value } from "./client";
import { Feedback, useOperation } from "./shared";

type Item = {
  id: string;
  status: string;
  rowVersion: number;
  organization?: { name: string } | null;
  league?: { name: string } | null;
  totalRosterAttachment?: { id: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string } | null;
  validation?: { blockers: { message: string }[] };
  eventEntries?: { event: { name: string }; teams: { id: string; ordinal: number; rowVersion: number; admissionStatus?: string; members?: { participant?: { name?: string } }[] }[] }[];
};
type EventAdmission = {
  id: string;
  name: string;
  teamCapacity: number | null;
  admittedCount: number;
  pendingCount: number;
  remainingCapacity: number | null;
  teams: Array<{ id: string; ordinal: number; rowVersion: number; admissionStatus: string; registrationId: string; unit: string; rosterSize: number }>;
};

export function ReviewScreen({ activityId, admin = false }: { activityId: string; admin?: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [admissions, setAdmissions] = useState<EventAdmission[]>([]);
  const op = useOperation();

  const load = useCallback(async () => {
    try {
      const [reviewItems, admissionItems] = await Promise.all([
        api<Item[]>(`activities/${activityId}/registration-review`),
        admin ? api<EventAdmission[]>(`activities/${activityId}/event-admissions`) : Promise.resolve([]),
      ]);
      setItems(reviewItems);
      setAdmissions(admissionItems);
    } catch (e) {
      void op.run(() => Promise.resolve().then(() => {
        throw (e instanceof Error ? e : new Error("載入失敗"));
      }));
    }
  }, [activityId, admin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(id: string) {
    setSelected(await api<Item>(`registrations/${id}`));
  }
  async function admit(teamId: string, rowVersion: number) {
    await admissionAction(teamId, rowVersion, "admit");
  }
  async function admissionAction(teamId: string, rowVersion: number, kind: "admit" | "reject") {
    await op.run(async () => {
      await api(`teams/${teamId}/${kind}`, "POST", { rowVersion, reason: kind === "admit" ? "主辦確認隊伍錄取" : "主辦確認隊伍未錄取" });
      await load();
      if (selected) setSelected(await api<Item>(`registrations/${selected.id}`));
    }, kind === "admit" ? "隊伍已錄取" : "隊伍已標記為未錄取");
  }

  async function action(kind: "return" | "confirm", reasonText: string) {
    if (!selected) return;
    await op.run(async () => {
      await api(`registrations/${selected.id}/${kind}`, "POST", {
        rowVersion: selected.rowVersion,
        reason: reasonText,
      });
      setSelected(null);
      await load();
    }, kind === "return" ? "已退回報名" : "已確認報名內容");
  }

  const pendingAdmissions = admissions.flatMap((event) => event.teams
    .filter((team) => team.admissionStatus === "PENDING")
    .map((team) => ({ event, team })));

  return (
    <>
      <Feedback busy={op.busy} error={op.error} notice={op.notice} />
      {admin && <section className="card"><p className="eyebrow">隊伍錄取</p><h2>待主辦處理隊伍</h2><p>錄取隊伍才會正式計費並進入最終參賽資料；未錄取隊伍不計費。</p>{pendingAdmissions.length === 0 ? <p>目前沒有待錄取隊伍。</p> : <div className="tablewrap"><table><thead><tr><th>報名單位</th><th>賽事項目</th><th>隊伍</th><th>目前人數</th><th>賽事容量</th><th>操作</th></tr></thead><tbody>{pendingAdmissions.map(({ event, team }) => <tr key={team.id}><td>{team.unit}</td><td>{event.name}</td><td>{team.ordinal === 1 ? "A 隊" : team.ordinal === 2 ? "B 隊" : `第 ${team.ordinal} 隊`} · 待主辦錄取</td><td>{team.rosterSize}</td><td>{event.teamCapacity === null ? "不限" : `${event.admittedCount} / ${event.teamCapacity}`}</td><td><button onClick={() => void admissionAction(team.id, team.rowVersion, "admit")} disabled={op.busy}>錄取</button><button className="secondary" onClick={() => void admissionAction(team.id, team.rowVersion, "reject")} disabled={op.busy}>拒絕</button></td></tr>)}</tbody></table></div>}</section>}
      <section className="card">
        <h2>報名審核</h2>
        {items.length === 0 ? (
          <p>目前沒有待審核報名。</p>
        ) : (
          <ul>
            {items.map((r) => (
              <li key={r.id}>
                <button className="link" onClick={() => void open(r.id)}>
                  {r.organization?.name ?? r.league?.name ?? "報名"}
                </button>{" "}
                · 審核中
              </li>
            ))}
          </ul>
        )}
      </section>
      {selected && (
        <section className="card">
          <h2>審核報名</h2>
          <p>報名單位：{selected.organization?.name ?? selected.league?.name}</p>
          {selected.totalRosterAttachment ? <p>總參賽名單（示範）：<span className="muted">示範名單資訊（無實際檔案）</span></p> : <p role="alert">尚未附上總參賽名單（示範）。</p>}
          {selected.validation?.blockers.map((b, i) => (
            <p key={i}>⚠ {b.message}</p>
          ))}
          {selected.eventEntries?.map((entry) => <section className="notice" key={entry.event.name}><strong>{entry.event.name}</strong>{entry.teams.map((team) => <p key={team.id}>{team.ordinal === 1 ? "A 隊" : "B 隊"} · {team.admissionStatus === "PENDING" ? "待主辦錄取" : team.admissionStatus === "REJECTED" ? "未錄取" : "已錄取"}{team.members?.length ? ` · 選手：${team.members.map((member) => member.participant?.name).filter(Boolean).join("、")}` : " · 尚未配置選手"}{team.admissionStatus === "PENDING" && <><button className="secondary" onClick={() => void admit(team.id, team.rowVersion)} disabled={op.busy}>錄取</button><button className="secondary" onClick={() => void admissionAction(team.id, team.rowVersion, "reject")} disabled={op.busy}>拒絕</button></>}</p>)}</section>)}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.currentTarget;
              void action("return", value(f, "reason"));
            }}
          >
            <label>
              退回原因
              <textarea name="reason" required maxLength={1000} />
            </label>
            <button disabled={op.busy}>退回修改</button>
          </form>
          <button
            disabled={op.busy || Boolean(selected.validation?.blockers.length)}
            onClick={() => void action("confirm", "審核通過")}
          >
            確認報名內容（不代表財務結算）
          </button>
          <button className="secondary" onClick={() => setSelected(null)}>
            關閉
          </button>
        </section>
      )}
    </>
  );
}

type LeaderReviewItem = {
  id: string;
  status: string;
  organization?: { name: string } | null;
  league?: { name: string } | null;
  writable?: boolean;
  totalRosterAttachment?: { id: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string } | null;
};
type LeaderReviewDetail = LeaderReviewItem & { returnReason?: string | null; eventEntries?: { event?: { name: string }; teams?: { ordinal: number; admissionStatus: string; members?: { participant?: { name?: string } }[] }[] }[]; payments?: { status: string }[]; amountDue?: number; balanceDue?: number };

const leaderStatus: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "審核中",
  RETURNED: "退回修改",
  CONFIRMED: "審核通過",
};
const leaderPaymentStatus: Record<string, string> = { PENDING: "待確認", SUBMITTED: "待確認", REJECTED: "已退回", CONFIRMED: "已確認", APPROVED: "已確認" };

export function LeaderReviewScreen({ activityId }: { activityId: string }) {
  const [items, setItems] = useState<LeaderReviewItem[]>([]);
  const [selected, setSelected] = useState<LeaderReviewDetail | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setItems(await api<LeaderReviewItem[]>(`activities/${activityId}/registrations`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "無法載入審核結果"); }
  }, [activityId]);
  useEffect(() => { void load(); }, [load]);
  return <section className="card leader-review-screen"><p className="eyebrow">02 完成報名</p><h2>審核結果</h2><p>查看本社團與所屬聯隊的報名、隊伍錄取及付款進度。</p>{error ? <div role="alert" className="alert error">{error}<button className="secondary" onClick={() => void load()}>重新整理</button></div> : items.length === 0 ? <p className="empty-note">目前尚未建立報名資料。</p> : <div className="leader-review-list">{items.map((item) => <article className="notice" key={item.id}><button className="link" onClick={() => void api<LeaderReviewDetail>(`registrations/${item.id}`).then((detail) => setSelected({ ...detail, payments: detail.payments?.map((payment) => ({ status: leaderPaymentStatus[payment.status] ?? "待確認" })) })).catch((cause) => setError(cause instanceof Error ? cause.message : "無法載入報名詳情"))}><strong>{item.organization?.name ?? item.league?.name ?? "報名單位"}</strong> · {leaderStatus[item.status] ?? item.status}</button>{selected?.id === item.id && <div className="leader-review-detail">{selected.totalRosterAttachment ? <p>總參賽名單（示範）：<span className="muted">示範名單資訊（無實際檔案）</span></p> : <p>尚未上傳總參賽名單（示範）。</p>}<p>報名資料：{leaderStatus[selected.status] ?? selected.status}</p>{selected.returnReason && <p role="alert">退回原因：{selected.returnReason}</p>}{selected.eventEntries?.map((entry, index) => <div key={entry.event?.name ?? index}><strong>{entry.event?.name ?? "賽事"}</strong>{entry.teams?.map((team) => <p key={team.ordinal}> {team.ordinal === 1 ? "A 隊" : "B 隊"}：{selected.status !== "CONFIRMED" && team.admissionStatus === "ADMITTED" ? "報名待審核" : team.admissionStatus === "ADMITTED" ? "已錄取" : team.admissionStatus === "REJECTED" ? "未錄取" : "待主辦錄取"}{team.members?.length ? ` · 選手：${team.members.map((member) => member.participant?.name).filter(Boolean).join("、")}` : " · 尚未配置選手"}</p>)}</div>)}<p>付款狀態：{selected.payments?.length ? selected.payments.map((payment) => payment.status).join("、") : "尚未回報"}</p></div>}</article>)}</div>}</section>;
}
