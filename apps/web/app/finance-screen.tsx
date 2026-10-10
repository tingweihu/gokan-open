"use client";

import { useCallback, useEffect, useState } from "react";
import { api, value } from "./client";
import { Feedback, useOperation } from "./shared";

type Registration = { id: string; status: string; rowVersion: number; createdAt?: string; submittedAt?: string | null; updatedAt?: string; organization?: { name: string } | null; league?: { name: string } | null; validation?: { blockers?: { code?: string; message: string }[] } };
type Proof = { id: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string };
type Finance = { registrationId: string; status: string; submittedAt?: string | null; totalRosterAttachment?: Proof | null; remittanceInstructions?: string | null; baseFee: number; participantCount: number; participantFee: number; participantFeeSubtotal: number; eventTeamFeeSubtotal: number; eventFees: { eventId: string; eventName: string; teamCount: number; admittedTeamCount: number; pendingTeamCount: number; rejectedTeamCount: number; unitFee: number; subtotal: number; billed: boolean; overridden: boolean }[]; amountDue: number; confirmedPayments: number; completedRefunds: number; netPaid: number; balanceDue: number; credit: number; availableRefundRequest: number; financiallyEligible: boolean; eligibility: { registrationConfirmed: boolean; eligible: boolean }; payments: { id: string; amount: number; status: string; paidAt: string; payerName?: string | null; reference?: string | null; rowVersion: number; proofAttachmentId?: string | null; reviewNote?: string | null }[]; refunds: { id: string; amount: number; status: string; rowVersion: number }[] };
type Payment = { id: string; amount: number; status: string; paidAt: string; createdAt?: string; payerName?: string | null; bankAccountLastFive?: string | null; reference?: string | null; rowVersion: number; submittedBy?: { displayName: string; email: string }; attachment?: Proof | null; registration: Registration };
type Refund = { id: string; amount: number; reason: string; status: string; rowVersion: number; registration: Registration };
type FeeSchedule = { id?: string; registrationBaseFee: number; participantFee: number; defaultTeamEntryFee: number; rowVersion: number; activityRowVersion?: number; remittanceInstructions?: string | null; feeOverrides: { eventId: string; teamEntryFee: number }[] };
type Event = { id: string; name: string; enabled: boolean };
type ActivityState = { registrationOpensAt: string | null; registrationClosesAt: string | null; remittanceInstructions?: string | null; rowVersion?: number };
type FeeDraft = { registrationBaseFee: string; participantFee: string; defaultTeamEntryFee: string; eventFees: Record<string, string>; eventOverrides: Record<string, boolean> };

const money = (amount: number) => `NT$ ${amount.toLocaleString("zh-TW")}`;
const displayUnit = (registration: Registration) => registration.organization?.name ?? registration.league?.name ?? "報名";
const statusLabel = (status: string, submittedAt?: string | null) => (status === "DRAFT" && submittedAt ? "選手名單已送出" : ({ DRAFT: "草稿", RETURNED: "需修改", SUBMITTED: "待審核", CONFIRMED: "已確認" } as Record<string, string>)[status] ?? status);
const paymentStatusLabel = (status: string) => ({ PENDING: "待送出", SUBMITTED: "待審核", CONFIRMED: "已確認", REJECTED: "已退回", COMPLETED: "已完成", REQUESTED: "待處理", CANCELLED: "已取消" } as Record<string, string>)[status] ?? status;
const registrationQueue = (rows: Registration[]) => [...rows].sort((left, right) => {
  const rank = (status: string) => ({ SUBMITTED: 0, RETURNED: 1, CONFIRMED: 2, DRAFT: 3 } as Record<string, number>)[status] ?? 4;
  const byStatus = rank(left.status) - rank(right.status);
  if (byStatus) return byStatus;
  const leftAt = new Date(left.submittedAt ?? left.updatedAt ?? left.createdAt ?? 0).getTime();
  const rightAt = new Date(right.submittedAt ?? right.updatedAt ?? right.createdAt ?? 0).getTime();
  return leftAt - rightAt;
});
function createFeeDraft(schedule: FeeSchedule | null, listedEvents: Event[]): FeeDraft {
  const defaultFee = schedule?.defaultTeamEntryFee ?? 0;
  const overrides = new Map((schedule?.feeOverrides ?? []).map((item) => [item.eventId, item.teamEntryFee]));
  const eventFees = Object.fromEntries(listedEvents.map((event) => [event.id, String(overrides.get(event.id) ?? defaultFee)]));
  const eventOverrides = Object.fromEntries(listedEvents.map((event) => [event.id, overrides.has(event.id) && overrides.get(event.id) !== defaultFee]));
  return { registrationBaseFee: String(schedule?.registrationBaseFee ?? 0), participantFee: String(schedule?.participantFee ?? 0), defaultTeamEntryFee: String(defaultFee), eventFees, eventOverrides };
}

export function FinanceScreen({ activityId, staff, admin = false, leader = false, settings = false }: { activityId: string; staff: boolean; admin?: boolean; leader?: boolean; settings?: boolean }) {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [selected, setSelected] = useState<Finance | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [feeSchedule, setFeeSchedule] = useState<FeeSchedule | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [activity, setActivity] = useState<ActivityState | null>(null);
  const [editingFee, setEditingFee] = useState(false);
  const [feeDraft, setFeeDraft] = useState<FeeDraft | null>(null);
  const [remittanceDraft, setRemittanceDraft] = useState("");
  const [proof, setProof] = useState<{ file?: File; attachment?: Proof; error?: string }>({});
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { receivedAmount: string; reason: string }>>({});
  const op = useOperation();
  const registrationStarted = Boolean(activity?.registrationOpensAt && new Date() >= new Date(activity.registrationOpensAt));
  const load = useCallback(async () => {
    try {
      setRegistrations(registrationQueue(await api<Registration[]>(`activities/${activityId}/registrations`)));
      if (staff) {
        const [paymentRows, refundRows] = await Promise.all([api<Payment[]>(`activities/${activityId}/payment-review`), api<Refund[]>(`activities/${activityId}/refund-review`)]);
        setPayments([...paymentRows].sort((left, right) => new Date(left.createdAt ?? left.paidAt).getTime() - new Date(right.createdAt ?? right.paidAt).getTime())); setRefunds(refundRows);
      }
      if (admin || settings) {
        const [schedule, listedEvents, current] = await Promise.all([api<FeeSchedule | null>(`activities/${activityId}/fee-schedule`), api<Event[]>(`activities/${activityId}/events`), api<ActivityState>(`activities/${activityId}`)]);
        const enabledEvents = listedEvents.filter((event) => event.enabled);
        setFeeSchedule(schedule); setEvents(enabledEvents); setFeeDraft(createFeeDraft(schedule, enabledEvents)); setRemittanceDraft(schedule?.remittanceInstructions ?? ""); setActivity(current); setEditingFee((current) => current || !schedule?.id);
      }
    } catch (error) { await op.run(() => Promise.reject(error instanceof Error ? error : new Error("無法載入財務資料"))); }
  }, [activityId, admin, settings, staff]);
  useEffect(() => { void load(); }, [load]);
  async function open(id: string) { await op.run(() => api<Finance>(`registrations/${id}/finance`).then(setSelected)); }
  async function chooseProof(file?: File) {
    if (!file || !selected) return;
    setProof({ file });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      const attachment = await api<Proof>(`registrations/${selected.registrationId}/payment-proof`, "POST", { filename: file.name, mime: file.type, base64: btoa(binary) });
      setProof({ file, attachment });
    } catch (error) { setProof({ file, error: error instanceof Error ? error.message : "付款證明上傳失敗" }); }
  }
  async function submitPayment(form: HTMLFormElement) {
    if (!selected) return;
    await op.run(async () => { await api(`registrations/${selected.registrationId}/payments`, "POST", { amount: Number(value(form, "amount")), paidAt: new Date(value(form, "paidAt")).toISOString(), payerName: value(form, "payerName") || null, bankAccountLastFive: value(form, "bankAccountLastFive") || null, reference: value(form, "reference") || null, proofAttachmentId: proof.attachment?.id ?? null }); setProof({}); await open(selected.registrationId); await load(); }, "付款資料已送出");
  }
  async function reviewPayment(payment: Payment, status: "confirm" | "reject") { const draft = reviewDrafts[payment.id]; const receivedAmount = draft?.receivedAmount.trim(); await op.run(async () => { await api(`payments/${payment.id}/${status}`, "POST", { rowVersion: payment.rowVersion, reason: draft?.reason.trim() || (status === "reject" ? "資料需補充" : "審核通過"), ...(receivedAmount ? { receivedAmount: Number(receivedAmount) } : {}) }); setReviewDrafts((current) => { const next = { ...current }; delete next[payment.id]; return next; }); await load(); if (selected) await open(selected.registrationId); }, status === "confirm" ? "付款已確認" : "付款已退回"); }
  async function reviewRefund(refund: Refund, status: "complete" | "cancel") { await op.run(async () => { await api(`refunds/${refund.id}/${status}`, "POST", { rowVersion: refund.rowVersion, reason: status === "complete" ? "退款完成" : "取消退款" }); await load(); if (selected) await open(selected.registrationId); }, status === "complete" ? "退款已完成" : "退款已取消"); }
  async function requestRefund(form: HTMLFormElement) { if (!selected) return; await op.run(async () => { await api(`registrations/${selected.registrationId}/refunds`, "POST", { amount: Number(value(form, "refundAmount")), reason: value(form, "refundReason") }); await open(selected.registrationId); await load(); }, "退款申請已送出"); }
  async function saveFeeSettings() {
    await op.run(async () => {
      if (!feeDraft) throw new Error("費用設定尚未載入，請重新整理後再試。");
      const readMoney = (raw: string, label: string) => {
        if (!raw.trim()) throw new Error(`${label}不可空白`);
        const amount = Number(raw);
        if (!Number.isInteger(amount) || amount < 0) throw new Error(`${label}必須是 0 或以上的整數`);
        return amount;
      };
      const defaultTeamEntryFee = readMoney(feeDraft.defaultTeamEntryFee, "預設賽事項目費");
      const overrides = events.map((event) => {
        const raw = feeDraft.eventOverrides[event.id] ? feeDraft.eventFees[event.id] ?? "" : feeDraft.defaultTeamEntryFee;
        return { eventId: event.id, teamEntryFee: readMoney(raw, `${event.name} 個別費用`) };
      }).filter((item) => item.teamEntryFee !== defaultTeamEntryFee);
      const schedule = await api<FeeSchedule>(`activities/${activityId}/fee-configuration`, "PATCH", { registrationBaseFee: readMoney(feeDraft.registrationBaseFee, "社團基本費"), participantFee: readMoney(feeDraft.participantFee, "每位選手費用"), defaultTeamEntryFee, overrides, rowVersion: feeSchedule?.rowVersion ?? 1, reason: "更新本年度報名費設定" });
      setFeeSchedule(schedule); setFeeDraft(createFeeDraft(schedule, events)); setEditingFee(false); await load();
    }, "本年度報名費設定已儲存");
  }
  async function saveRemittanceInstructions() {
    await op.run(async () => {
      const result = await api<Pick<FeeSchedule, "activityRowVersion" | "remittanceInstructions">>(`activities/${activityId}/remittance-instructions`, "PATCH", { remittanceInstructions: remittanceDraft.trim() || null, rowVersion: feeSchedule?.activityRowVersion ?? activity?.rowVersion ?? 1, reason: "更新匯款資訊" });
      setRemittanceDraft(result.remittanceInstructions ?? "");
      setFeeSchedule((current) => current ? { ...current, activityRowVersion: result.activityRowVersion, remittanceInstructions: result.remittanceInstructions } : current);
      setActivity((current) => current ? { ...current, rowVersion: result.activityRowVersion, remittanceInstructions: result.remittanceInstructions } : current);
    }, "匯款資訊已儲存");
  }
  const effectiveEventFee = (eventId: string) => feeSchedule?.feeOverrides.find((item) => item.eventId === eventId)?.teamEntryFee ?? feeSchedule?.defaultTeamEntryFee ?? 0;
  if (settings && admin && !feeDraft) return <><Feedback busy={op.busy} error={op.error} notice={op.notice} /><section className="card fee-settings-card"><p className="eyebrow">年度設定 · 收費標準</p><h2>報名費設定</h2><p className="muted">正在載入收費設定…</p></section></>;
  if (leader && !settings) return <LeaderFinanceWorkspace activityId={activityId} />;
  return <><Feedback busy={op.busy} error={op.error} notice={op.notice} />
    {settings && admin && <section className="card fee-settings-card"><p className="eyebrow">年度設定 · 收費標準</p><h2>報名費設定</h2><p>系統計算方式：社團基本費＋實際參賽選手費＋每個已報名賽事項目費。</p>{!editingFee && feeSchedule?.id ? <div className="fee-summary"><p><strong>本年度報名費設定已儲存</strong></p><div className="fee-summary-grid"><section><h3>社團基本費</h3><strong>{money(feeSchedule.registrationBaseFee)}</strong></section><section><h3>每位參賽選手</h3><strong>{money(feeSchedule.participantFee)}</strong></section><section><h3>預設賽事項目費</h3><strong>{money(feeSchedule.defaultTeamEntryFee)}</strong></section></div><div className="fee-event-list"><h3>個別賽事項目費</h3>{events.length ? <ul>{events.map((event) => <li key={event.id}><span>{event.name}</span><strong>{money(effectiveEventFee(event.id))}</strong></li>)}</ul> : <p className="muted">目前沒有啟用中的賽事項目。</p>}</div>{registrationStarted ? <p className="lock-banner">報名已開始，本年度報名費設定已鎖定。</p> : <button type="button" className="secondary" onClick={() => setEditingFee(true)}>編輯報名費設定</button>}</div> : <form onSubmit={(event) => { event.preventDefault(); void saveFeeSettings(); }}><div className="formgrid"><label>社團基本費<input name="registrationBaseFee" type="number" min="0" required value={feeDraft?.registrationBaseFee ?? ""} onChange={(event) => { const raw = event.target.value; setFeeDraft((draft) => draft ? { ...draft, registrationBaseFee: raw } : draft); }} /></label><label>每位選手費用<input name="participantFee" type="number" min="0" required value={feeDraft?.participantFee ?? ""} onChange={(event) => { const raw = event.target.value; setFeeDraft((draft) => draft ? { ...draft, participantFee: raw } : draft); }} /></label><label>預設賽事項目費<input name="defaultTeamEntryFee" type="number" min="0" required value={feeDraft?.defaultTeamEntryFee ?? ""} onChange={(event) => { const raw = event.target.value; setFeeDraft((draft) => draft ? { ...draft, defaultTeamEntryFee: raw } : draft); }} /></label></div><div className="fee-event-list"><h3>個別賽事項目費</h3><p className="muted">未另行設定的賽事項目會套用預設費用；只有不同於預設費用的項目會建立個別設定。</p>{events.length ? <div className="fee-event-grid">{events.map((event) => <label key={event.id}>{event.name}<input name={`event-${event.id}`} type="number" min="0" required value={feeDraft ? (feeDraft.eventOverrides[event.id] ? feeDraft.eventFees[event.id] ?? "" : feeDraft.defaultTeamEntryFee) : ""} onChange={(inputEvent) => setFeeDraft((draft) => { if (!draft) return draft; const raw = inputEvent.target.value.trim(); const defaultRaw = draft.defaultTeamEntryFee.trim(); const eventFees = { ...draft.eventFees, [event.id]: raw }; const numeric = raw ? Number(raw) : null; const defaultNumeric = defaultRaw ? Number(defaultRaw) : null; return { ...draft, eventFees, eventOverrides: { ...draft.eventOverrides, [event.id]: raw !== "" && numeric !== null && defaultNumeric !== null && Number.isFinite(numeric) && numeric !== defaultNumeric } }; })} /></label>)}</div> : <p className="muted">目前沒有啟用中的賽事項目。</p>}</div><div className="button-group"><button disabled={op.busy || registrationStarted}>儲存收費設定</button></div></form>}</section>}
    {settings && admin && <section className="card fee-settings-card"><p className="eyebrow">年度設定 · 付款說明</p><h2>匯款資訊</h2><p className="muted">這段文字會顯示給參賽者與領隊，請填寫目前適用的匯款說明；正式銀行帳號確認後再補上。</p><textarea value={remittanceDraft} maxLength={4000} rows={5} placeholder="例如：請依主辦單位通知完成匯款，並填寫付款資訊。" onChange={(event) => setRemittanceDraft(event.target.value)} /><div className="button-group"><button type="button" onClick={() => void saveRemittanceInstructions()} disabled={op.busy}>儲存匯款資訊</button></div></section>}
    {!settings && <section className="card"><h2>費用</h2>{registrations.length === 0 ? <p>目前沒有可查看的報名。</p> : <ul>{registrations.map((registration) => <li key={registration.id}><button className="link" onClick={() => void open(registration.id)}>{displayUnit(registration)}</button> · {statusLabel(registration.status, registration.submittedAt)}</li>)}</ul>}</section>}
    {selected && <section className="card"><h2>費用明細</h2>{selected.remittanceInstructions && <div className="notice"><strong>匯款資訊</strong><p>{selected.remittanceInstructions}</p></div>}<p className="muted">已錄取隊伍正式計費；待主辦錄取隊伍暫不計費；未錄取隊伍不計費。每個賽事項目最多計費一次，同一位選手跨多個已錄取賽事也只計一次選手費。</p><div className="fee-summary-grid"><section><h3>應繳總額</h3><strong>{money(selected.amountDue)}</strong></section><section><h3>已確認付款</h3><strong>{money(selected.confirmedPayments)}</strong></section><section><h3>尚待付款</h3><strong>{money(selected.balanceDue)}</strong></section><section><h3>可退餘額</h3><strong>{money(selected.credit)}</strong></section></div><p>報名狀態：{selected.eligibility.registrationConfirmed ? "已確認" : "尚未確認"}；目前正式錄取項目的財務資格：{selected.financiallyEligible ? "符合" : "尚未符合"}</p><ul>{selected.eventFees.map((item) => <li key={item.eventId}>{item.eventName}：{money(item.subtotal)} · {item.admittedTeamCount > 0 ? `已錄取 ${item.admittedTeamCount} 隊，正式計費` : item.pendingTeamCount > 0 ? "待主辦錄取，暫不計費" : "未錄取，不計費"}</li>)}</ul>{!staff && hasPaymentForm(selected) && <form onSubmit={(event) => { event.preventDefault(); void submitPayment(event.currentTarget); }}><h3>提交付款</h3><label>金額<input name="amount" type="number" min="1" required /></label><label>付款日期<input name="paidAt" type="datetime-local" step="1" required /></label><label>付款人<input name="payerName" maxLength={120} /></label><label>帳號末五碼<input name="bankAccountLastFive" pattern="[0-9]{5}" maxLength={5} /></label><label>備註／參考編號<input name="reference" maxLength={200} /></label><label>付款證明（PDF／JPG／JPEG／PNG，非必須；上傳可加速審核）<span className="muted">僅接受 PDF、JPG、JPEG、PNG，單一檔案上限 10 MB。</span><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => void chooseProof(event.target.files?.[0])} /></label>{proof.file && <p role="status">{proof.attachment ? `已上傳：${proof.attachment.originalName}` : proof.error ?? "上傳中…"}</p>}<div className="action-footer"><button type="button" className="secondary" onClick={() => setSelected(null)}>關閉</button><button disabled={op.busy || Boolean(proof.file && !proof.attachment)}>送出付款資料</button></div></form>}{selected.refunds.length > 0 && <div><h3>退款紀錄</h3><ul>{selected.refunds.map((refund) => <li key={refund.id}>{money(refund.amount)} · {refund.status}</li>)}</ul></div>}{!staff && selected.availableRefundRequest > 0 && <form onSubmit={(event) => { event.preventDefault(); void requestRefund(event.currentTarget); }}><h3>申請退款</h3><p>扣除待處理退款後，目前最多可申請 {money(selected.availableRefundRequest)}。</p><label>金額<input name="refundAmount" type="number" min="1" max={selected.availableRefundRequest} required /></label><label>退款原因<input name="refundReason" maxLength={500} required /></label><button disabled={op.busy}>送出退款申請</button></form>}</section>}
    {staff && !settings && selected && <section className="card payment-history"><h2>領隊付款明細</h2>{selected.payments.length === 0 ? <p>此報名尚無付款紀錄。</p> : <ul>{selected.payments.map((payment) => <li key={payment.id}><strong>{money(payment.amount)}</strong> · {paymentStatusLabel(payment.status)}<span className="muted">付款日期：{new Date(payment.paidAt).toLocaleString("zh-TW")} · 付款人：{payment.payerName ?? "未填"}{payment.reference ? ` · 參考編號：${payment.reference}` : ""}</span>{payment.reviewNote && <span className="muted">審核紀錄：{payment.reviewNote}</span>}</li>)}</ul>}</section>}
    {staff && !settings && <><section className="card"><h2>付款審核</h2>{payments.length === 0 ? <p>目前沒有待審核付款。</p> : <ul>{payments.map((payment) => <li key={payment.id} className="payment-review-item"><strong>{displayUnit(payment.registration)}</strong> · {money(payment.amount)} · {paymentStatusLabel(payment.status)}<p className="muted">付款人：{payment.payerName ?? "未填"} · 日期：{new Date(payment.paidAt).toLocaleString("zh-TW")} · 提交者：{payment.submittedBy?.displayName ?? "—"}</p>{payment.reference && <p className="muted">參考編號：{payment.reference}</p>}{payment.attachment && <a className="button secondary" href={`/api/attachments/${payment.attachment.id}/content`} target="_blank" rel="noreferrer">檢視付款證明</a>}<label>實收金額（可填）<input type="number" min="0" value={reviewDrafts[payment.id]?.receivedAmount ?? ""} onChange={(event) => setReviewDrafts((current) => ({ ...current, [payment.id]: { receivedAmount: event.target.value, reason: current[payment.id]?.reason ?? "" } }))} /></label><label>審核備註（可填）<textarea value={reviewDrafts[payment.id]?.reason ?? ""} onChange={(event) => setReviewDrafts((current) => ({ ...current, [payment.id]: { receivedAmount: current[payment.id]?.receivedAmount ?? "", reason: event.target.value } }))} /></label><div className="button-group"><button onClick={() => void reviewPayment(payment, "confirm")}>確認收款</button><button className="secondary" onClick={() => void reviewPayment(payment, "reject")}>退回補件</button></div></li>)}</ul>}</section><section className="card"><h2>退款審核</h2>{refunds.length === 0 ? <p>目前沒有退款申請。</p> : <ul>{refunds.map((refund) => <li key={refund.id}><strong>{displayUnit(refund.registration)}</strong> · {paymentStatusLabel(refund.status)} · {refund.reason}{refund.status === "REQUESTED" && <><button onClick={() => void reviewRefund(refund, "complete")}>完成退款</button><button className="secondary" onClick={() => void reviewRefund(refund, "cancel")}>取消退款</button></>}</li>)}</ul>}</section></>}
  </>;
}

function LeaderFinanceWorkspace({ activityId }: { activityId: string }) {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [activity, setActivity] = useState<ActivityState | null>(null);
  const [selected, setSelected] = useState<Finance | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<{ file?: File; attachment?: Proof; error?: string }>({});
  const [totalRoster, setTotalRoster] = useState<{ file?: File; attachment?: Proof; error?: string }>({});
  const load = useCallback(async () => { try { const [rows, current] = await Promise.all([api<Registration[]>(`activities/${activityId}/registrations`), api<ActivityState>(`activities/${activityId}`)]); setRegistrations(registrationQueue(rows)); setActivity(current); } catch (cause) { setError(cause instanceof Error ? cause.message : "無法載入費用與送出資料"); } }, [activityId]);
  useEffect(() => { void load(); }, [load]);
  async function open(id: string) { const row = registrations.find((item) => item.id === id); if (row && !row.submittedAt) { setSelected(null); setError("請先到「賽事與人力」送出選手名單，費用明細會在送出後顯示。"); return; } setBusy(true); setError(""); try { setSelected(await api<Finance>(`registrations/${id}/finance`)); } catch (cause) { setError(cause instanceof Error ? cause.message : "無法載入費用明細"); } finally { setBusy(false); } }
  async function chooseProof(file?: File) {
    if (!file || !selected) return;
    setProof({ file });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      const attachment = await api<Proof>(`registrations/${selected.registrationId}/payment-proof`, "POST", { filename: file.name, mime: file.type, base64: btoa(binary) });
      setProof({ file, attachment });
    } catch (cause) {
      setProof({ file, error: cause instanceof Error ? cause.message : "付款證明上傳失敗" });
    }
  }
  async function chooseTotalRoster(file?: File) {
    if (!file || !selected) return;
    setTotalRoster({ file });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      const attachment = await api<Proof>(`registrations/${selected.registrationId}/total-roster`, "POST", { filename: file.name, mime: file.type, base64: btoa(binary) });
      setTotalRoster({ file, attachment });
      await open(selected.registrationId);
    } catch (cause) { setTotalRoster({ file, error: cause instanceof Error ? cause.message : "總參賽名單上傳失敗" }); }
  }
  const registrationClosed = Boolean(activity?.registrationClosesAt && new Date() >= new Date(activity.registrationClosesAt));
  const registrationEditingLocked = Boolean(selected && registrationClosed && ["DRAFT", "RETURNED"].includes(selected.status));
  const totalRosterEditable = Boolean(selected && !registrationEditingLocked && ["DRAFT", "RETURNED"].includes(selected.status));
  async function submit(form: HTMLFormElement) { if (!selected || registrationEditingLocked) return; setBusy(true); setError(""); try { await api(`registrations/${selected.registrationId}/payments`, "POST", { amount: Number(value(form, "amount")), paidAt: new Date(value(form, "paidAt")).toISOString(), payerName: value(form, "payerName") || null, bankAccountLastFive: value(form, "bankAccountLastFive") || null, reference: value(form, "reference") || null, proofAttachmentId: proof.attachment?.id ?? null }); setNotice("繳費資訊已回報"); setProof({}); setExpanded(false); await open(selected.registrationId); } catch (cause) { setError(cause instanceof Error ? cause.message : "繳費資訊回報失敗"); } finally { setBusy(false); } }
  async function submitRegistration() { if (!selected || registrationEditingLocked) return; setBusy(true); setError(""); try { const registration = await api<Registration>(`registrations/${selected.registrationId}`); const blockers = registration.validation?.blockers ?? []; if (blockers.length) throw new Error(`報名尚有未完成項目：${blockers.map((blocker) => blocker.message).join("；")}`); await api(`registrations/${registration.id}/submit`, "POST", { rowVersion: registration.rowVersion, reason: "送出報名" }); setNotice("報名已送出"); await open(selected.registrationId); } catch (cause) { setError(cause instanceof Error ? `${cause.message} 請回到「賽事與人力」或「費用與送出」查看未完成項目。` : "報名送出失敗，請回到「賽事與人力」或「費用與送出」查看未完成項目。"); } finally { setBusy(false); } }
  return <><Feedback busy={busy} error={error} notice={notice} /><section className="card leader-finance-workspace"><p className="eyebrow">02 完成報名</p><h2>費用與送出</h2><p>查看目前應繳金額、回報付款資訊，並在資料完整後送出報名。</p><p className="muted">每次付款資料只需送出一次；如需補費，請依主辦單位通知再提交新的付款。</p>{activity?.remittanceInstructions && <div className="notice"><strong>匯款資訊</strong><p>{activity.remittanceInstructions}</p></div>}{registrations.length === 0 ? <p className="empty-note">目前尚未建立報名。</p> : <div className="registration-list">{registrations.map((registration) => registration.submittedAt ? <button className="link" key={registration.id} onClick={() => void open(registration.id)}>{displayUnit(registration)} · {statusLabel(registration.status, registration.submittedAt)}</button> : <div className="registration-list-item" key={registration.id}><strong>{displayUnit(registration)} · {statusLabel(registration.status, registration.submittedAt)}</strong><span className="muted">尚未送出選手名單，送出後才會顯示費用明細。</span></div>)}</div>}</section>{selected && <section className="card"><div className="section-heading"><h2>目前應繳 {money(selected.amountDue)}</h2><span className="badge">{statusLabel(selected.status, selected.submittedAt)}</span></div><div className="fee-summary-grid"><section><h3>基本費</h3><strong>{money(selected.baseFee)}</strong></section><section><h3>選手費</h3><strong>{money(selected.participantFeeSubtotal)}</strong></section><section><h3>賽事費</h3><strong>{money(selected.eventTeamFeeSubtotal)}</strong></section><section><h3>尚待付款</h3><strong>{money(selected.balanceDue)}</strong></section></div><ul>{selected.eventFees.map((item) => <li key={item.eventId}>{item.eventName}：{selected.status !== "CONFIRMED" ? "報名待審核" : item.admittedTeamCount ? "已錄取，正式計費" : item.pendingTeamCount ? "待主辦錄取，暫不計費" : "未錄取，不計費"}</li>)}</ul><div className="total-roster-upload"><h3>總參賽名單（學校核章）</h3><p className="muted">{totalRosterEditable ? "最終送出報名之前，請上傳學校核章的總參賽名單 PDF；報名截止前可重新上傳。" : "報名送出後，總參賽名單已鎖定；如需修改請等待主辦退回。"}</p><input type="file" accept="application/pdf,.pdf" disabled={!totalRosterEditable} onChange={(event) => void chooseTotalRoster(event.target.files?.[0])} />{selected.totalRosterAttachment && <p role="status">已上傳：{selected.totalRosterAttachment.originalName}</p>}{totalRoster.file && !totalRoster.attachment && <p role="status">{totalRoster.error ?? "上傳中…"}</p>}</div><p>報名送出不會因付款回報而自動完成；請依下方按鈕分別處理。</p>{registrationEditingLocked && <p className="lock-banner" role="alert">報名截止時間已過，草稿報名無法再編輯或送出。</p>}{!registrationEditingLocked && (!expanded ? <button onClick={() => setExpanded(true)} disabled={busy}>我已完成繳費，回報繳費資訊</button> : <form onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}><label>金額<input name="amount" type="number" min="1" required /></label><label>付款日期<input name="paidAt" type="datetime-local" step="1" required /></label><label>付款人<input name="payerName" maxLength={120} /></label><label>帳號末五碼<input name="bankAccountLastFive" maxLength={5} pattern="[0-9]{5}" /></label><label>備註／參考編號<input name="reference" maxLength={200} /></label><label>付款證明（PDF／JPG／JPEG／PNG，非必須；上傳可加速審核）<span className="muted">僅接受 PDF、JPG、JPEG、PNG，單一檔案上限 10 MB。</span><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => void chooseProof(event.target.files?.[0])} /></label>{proof.file && <p role="status">{proof.attachment ? `已上傳：${proof.attachment.originalName}` : proof.error ?? "上傳中…"}</p>}<div className="finance-payment-actions"><div className="button-group"><button disabled={busy || Boolean(proof.file && !proof.attachment)}>送出付款資訊</button><button type="button" className="secondary" onClick={() => { setExpanded(false); setProof({}); }}>取消</button></div></div></form>)}{["DRAFT", "RETURNED"].includes(selected.status) && !registrationEditingLocked && <div className="finance-registration-action"><p className="submit-warning" role="note">請於送出以前務必確認選手名單正確性、比賽內容正確性、匯款細節，送出後即將進入審核。</p><button className="primary-submit" disabled={busy || !selected.totalRosterAttachment} onClick={() => void submitRegistration()}>送出報名</button></div>}</section>}</>;
}

function hasPaymentForm(finance: Finance) { return finance.status !== "CONFIRMED" || !finance.financiallyEligible || finance.balanceDue > 0; }
