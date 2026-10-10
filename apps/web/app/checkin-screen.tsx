"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./client";

type Row = { eventId: string; 賽事項目: string; 選手姓名: string; 年級: string; 性別: string };

export function CheckInScreen({ activityId, admin }: { activityId: string; admin: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [allRows, setAllRows] = useState<Row[]>([]);
  const [eventId, setEventId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const events = useMemo(() => [...new Map(allRows.map((row) => [row.eventId, row.賽事項目])).entries()], [allRows]);
  const load = useCallback(async (selected = "") => {
    setLoading(true); setError("");
    try {
      const data = await api<Row[]>(`activities/${activityId}/check-in${selected ? `?eventId=${encodeURIComponent(selected)}` : ""}`);
      setRows(data);
      if (!selected) setAllRows(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "無法載入檢錄名單"); }
    finally { setLoading(false); }
  }, [activityId]);
  useEffect(() => { void load(); }, [load]);
  const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : "";
  return <>
    <section className="hero-panel checkin-hero"><div><p className="eyebrow">比賽現場</p><h2>檢錄名單已就緒</h2><p>選擇賽事項目後，可快速查找選手或下載現場用名單。</p></div><strong>{rows.length}<small> 位選手</small></strong></section>
    {error && <div role="alert" className="alert error">{error}<button className="secondary" onClick={() => void load(eventId)}>重新載入</button></div>}
    <section className="card filter-panel"><div><label htmlFor="checkin-event">賽事項目</label><select id="checkin-event" value={eventId} onChange={(event) => { const next = event.target.value; setEventId(next); void load(next); }}><option value="">全部賽事項目</option>{events.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div><div className="button-group" aria-label="下載檢錄名單"><a className="button-link secondary-link" href={`/api/activities/${activityId}/check-in.csv${query}`}>下載 CSV</a><a className="button-link" href={`/api/activities/${activityId}/check-in.xlsx${query}`}>下載 XLSX</a></div></section>
    {admin && <section className="card export-panel"><div><p className="eyebrow">年度封存</p><h2>完整年度資料</h2><p>僅系統管理員可下載。工作簿包含年度資料表，適合作為年度封存與交接資料。</p></div><div className="button-group"><a className="button-link" href={`/api/activities/${activityId}/exports/annual.xlsx`}>下載完整 XLSX</a></div></section>}
    <section className="card"><div className="section-heading"><div><p className="eyebrow">現場名單</p><h2>{eventId ? events.find(([id]) => id === eventId)?.[1] : "全部賽事項目"}</h2></div><span className="badge">僅顯示檢錄必要資料</span></div>{loading ? <p aria-busy="true">正在載入名單…</p> : rows.length === 0 ? <p className="empty-note">這個篩選條件目前沒有選手。</p> : <div className="tablewrap responsive-table"><table><thead><tr><th>賽事項目</th><th>選手姓名</th><th>年級</th><th>性別</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.eventId}-${row.選手姓名}-${index}`}><td data-label="賽事項目">{row.賽事項目}</td><td data-label="選手姓名"><strong>{row.選手姓名}</strong></td><td data-label="年級">{row.年級}</td><td data-label="性別">{row.性別}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
