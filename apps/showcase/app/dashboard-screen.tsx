"use client";
import { demoNow } from "./demo-state";

import { useCallback, useEffect, useState } from "react";
import { api } from "./client";

type Activity = {
  name: string;
  stage: string;
  registrationClosesAt: string | null;
  paymentDueAt: string | null;
  leaderMeetingStartsAt: string | null;
  competitionStartsAt: string | null;
};
type Registration = {
  id: string;
  status: string;
  organization?: { name: string } | null;
  league?: { name: string } | null;
};
type Payment = { id: string };
type DashboardSummary = {
  clubs: { total: number; loggedIn: number; registering: number; paying: number; completed: number };
  participants: { total: number; male: number; female: number; grade1: number; grade2: number; grade3: number; assignedThroughLeague: number; notAssignedThroughLeague: number };
  finance: { expectedRevenue: number; paidRevenue: number; outstandingRevenue: number };
  reviews: { pending: number; returned: number; confirmed: number };
};

const stageNames: Record<string, string> = {
  SETUP: "活動設定中",
  BEFORE_REGISTRATION: "等待報名開始",
  REGISTRATION: "報名進行中",
  BEFORE_LEADER_MEETING: "報名已截止",
  LEADER_MEETING: "領隊會議進行中",
  POST_LEADER_MEETING: "會後調整期間",
  COMPETITION: "比賽進行中",
  CLOSEOUT: "本年度賽事完成",
  ARCHIVED: "活動已封存",
};
const registrationNames: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "等待審核",
  RETURNED: "需要修改",
  CONFIRMED: "內容已確認",
};

function date(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" }) : "尚未設定";
}
const money = (amount: number) => `NT$${amount.toLocaleString("zh-TW")}`;
const milestoneDefinitions = [
  { key: "registrationClosesAt", name: "報名截止", past: "已截止" },
  { key: "paymentDueAt", name: "繳費截止", past: "已截止" },
  { key: "leaderMeetingStartsAt", name: "領隊會議", past: "已完成" },
  { key: "competitionStartsAt", name: "正式比賽", past: "已完成" },
] as const;

function milestoneStatus(value: string | null, past: string) {
  if (!value) return "尚未設定";
  const milliseconds = new Date(value).getTime() - demoNow();
  if (milliseconds <= 0) return past;
  return `還有 ${Math.max(1, Math.ceil(milliseconds / 86_400_000))} 天`;
}

export function DashboardScreen({ activityId, staff, admin, onNavigate }: { activityId: string; staff: boolean; admin: boolean; hasClub?: boolean; onNavigate: (page: string) => void }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [pendingPayments, setPendingPayments] = useState(0);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [current, items] = await Promise.all([
        api<Activity>(`activities/${activityId}`),
        api<Registration[]>(`activities/${activityId}/registrations`),
      ]);
      setActivity(current);
      setRegistrations(items);
      if (admin) setSummary(await api<DashboardSummary>(`activities/${activityId}/dashboard-summary`));
      if (staff) {
        const payments = await api<Payment[]>(`activities/${activityId}/payment-review`);
        setPendingPayments(payments.length);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "無法載入總覽");
    }
  }, [activityId, staff, admin]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <div role="alert" className="alert error">{error}</div>;
  if (!activity) return <section className="card loading-card" aria-busy="true">正在整理目前進度…</section>;
  const waiting = registrations.filter((item) => item.status === "SUBMITTED").length;
  const returned = registrations.filter((item) => item.status === "RETURNED").length;
  const confirmed = registrations.filter((item) => item.status === "CONFIRMED").length;
  const financeCompletion = summary && summary.finance.expectedRevenue > 0
    ? Math.min(100, Math.round((summary.finance.paidRevenue / summary.finance.expectedRevenue) * 100))
    : 0;
  const milestones = milestoneDefinitions.map((definition) => ({
    ...definition,
    dateValue: activity[definition.key],
    showTime: definition.key === "registrationClosesAt",
    status: milestoneStatus(activity[definition.key], definition.past),
  }));
  const nextMilestone = milestones.findIndex((milestone) => milestone.dateValue && new Date(milestone.dateValue).getTime() > demoNow());
  const recommendation = admin || staff
    ? waiting
      ? { page: "報名審核", title: `有 ${waiting} 筆報名等待審核`, description: "請先處理待審核報名，確認參賽資料。", button: "前往處理" }
      : pendingPayments
        ? { page: "費用管理", title: `有 ${pendingPayments} 筆付款等待確認`, description: "請確認付款資料與收款狀態。", button: "前往處理" }
        : admin && activity.stage === "SETUP"
          ? { page: "年度設定", title: "完成年度設定", description: "先完成活動日期與基本設定，再進行賽事項目、報名費與參賽管理。", button: "前往設定" }
          : { page: admin ? "檢錄與匯出" : "費用管理", title: "檢查賽前資料與匯出準備", description: "系統已依目前狀態整理最需要處理的工作。", button: "前往處理" }
    : returned
      ? { page: "審核結果", title: "依主辦意見修正報名", description: "系統已依目前狀態整理最需要處理的工作。", button: "前往處理" }
      : registrations.length
        ? { page: "費用與送出", title: "檢查報名與費用狀態", description: "系統已依目前狀態整理最需要處理的工作。", button: "前往處理" }
        : { page: "賽事與人力", title: "建立本年度報名與隊伍", description: "系統已依目前狀態整理最需要處理的工作。", button: "前往處理" };
  return <div className="dashboard-stack">
    <section className="hero-panel">
      <div><p className="eyebrow">目前活動階段</p><h2>{stageNames[activity.stage] ?? activity.stage}</h2><p>{activity.name}</p></div>
      <span className="stage-orb" aria-hidden="true" />
    </section>
    <section className="card important-dates" aria-labelledby="important-dates-title">
      <div className="section-heading"><div><p className="eyebrow">重要時間點</p><h2 id="important-dates-title">重要時間點</h2></div><span className="badge">依活動設定</span></div>
      <ol className="timeline-progress">
        {milestones.map((milestone, index) => <li className={index === nextMilestone ? "is-next" : milestone.dateValue && new Date(milestone.dateValue).getTime() <= demoNow() ? "is-complete" : ""} key={milestone.key} aria-current={index === nextMilestone ? "step" : undefined}>
          <span className="timeline-dot" aria-hidden="true" /><div><strong>{milestone.name}</strong><span className="timeline-status">{milestone.status}</span><time dateTime={milestone.dateValue ?? undefined}>{milestone.showTime ? date(milestone.dateValue) : date(milestone.dateValue).split(" ")[0]}</time></div>
        </li>)}
      </ol>
    </section>
    <section className="action-panel" aria-labelledby="next-action-title">
      <div><p className="eyebrow">目前建議作業</p><h2 id="next-action-title">{recommendation.title}</h2><p>{recommendation.description}</p></div>
      <button onClick={() => onNavigate(recommendation.page)}>{recommendation.button}</button>
    </section>
    <div className="metrics" aria-label="工作摘要">
      <article className="card metric-card"><p>等待審核</p><strong>{waiting}</strong><span>筆報名</span></article>
      <article className="card metric-card"><p>需要修改</p><strong>{returned}</strong><span>筆報名</span></article>
      <article className="card metric-card"><p>內容已確認</p><strong>{confirmed}</strong><span>筆報名</span></article>
    </div>
    {admin && summary && <div className="dashboard-grid">
      <section className="card dashboard-summary"><p className="eyebrow">社團概況</p><h2>社團概況</h2><div className="metrics"><article className="metric-card"><p>社團總數</p><strong>{summary.clubs.total}</strong></article><article className="metric-card"><p>已登入</p><strong>{summary.clubs.loggedIn}</strong></article><article className="metric-card"><p>報名中</p><strong>{summary.clubs.registering}</strong></article><article className="metric-card"><p>已完成</p><strong>{summary.clubs.completed}</strong></article></div></section>
      <section className="card"><p className="eyebrow">選手結構</p><h2>選手結構</h2><div className="metrics"><article className="metric-card"><p>有效選手</p><strong>{summary.participants.total}</strong></article><article className="metric-card"><p>男／女</p><strong>{summary.participants.male} ／ {summary.participants.female}</strong></article><article className="metric-card"><p>一年級／二年級</p><strong>{summary.participants.grade1} ／ {summary.participants.grade2}</strong></article><article className="metric-card"><p>聯隊指派</p><strong>{summary.participants.assignedThroughLeague}</strong></article></div></section>
      <section className="card"><p className="eyebrow">報名進度</p><h2>報名進度</h2><div className="metrics"><article className="metric-card"><p>待送出</p><strong>{summary.clubs.registering - waiting}</strong></article><article className="metric-card"><p>待審核</p><strong>{summary.reviews.pending}</strong></article><article className="metric-card"><p>需修改</p><strong>{summary.reviews.returned}</strong></article><article className="metric-card"><p>已確認</p><strong>{summary.reviews.confirmed}</strong></article></div></section>
      <section className="card"><p className="eyebrow">財務概況</p><h2>財務概況</h2><div className="metrics"><article className="metric-card"><p>預計收入</p><strong>{money(summary.finance.expectedRevenue)}</strong></article><article className="metric-card"><p>已確認收款</p><strong>{money(summary.finance.paidRevenue)}</strong></article><article className="metric-card"><p>待收款</p><strong>{money(summary.finance.outstandingRevenue)}</strong></article><article className="metric-card"><p>完成度</p><strong>{financeCompletion}%</strong><div className="metric-progress" role="progressbar" aria-label="收款完成度" aria-valuenow={financeCompletion} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${financeCompletion}%` }} /></div></article></div></section>
    </div>}
    {!admin && <section className="card"><p className="eyebrow">報名進度</p><h2>我的報名進度</h2>{registrations.length ? <ul className="status-list">{registrations.slice(0, 6).map((item) => <li key={item.id}><span>{item.organization?.name ?? item.league?.name ?? "報名"}</span><strong className={`badge status-${item.status.toLowerCase()}`}>{registrationNames[item.status] ?? item.status}</strong></li>)}</ul> : <p className="empty-note">準備開始報名：先建立隊伍與選手，再選擇今年要參加的比賽。</p>}</section>}
  </div>;
}
