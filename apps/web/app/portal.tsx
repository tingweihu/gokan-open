"use client";
import { api, value, download } from "./client";
import { AnnualSettings, ClubManagement } from "./setup-screens";
import { RosterScreen } from "./roster-screen";
import { CompetitionScreen } from "./competition-screen";
import { ScheduleScreen } from "./schedule-screen";
import { TeamsScreen } from "./teams-screen";
import { LeagueScreen } from "./league-screen";
import { RegistrationScreen } from "./registration-screen";
import { ReviewScreen } from "./review-screen";
import { LeaderReviewScreen } from "./review-screen";
import { FinanceScreen } from "./finance-screen";
import { DashboardScreen } from "./dashboard-screen";
import { CheckInScreen } from "./checkin-screen";
import { LeaderMeetingScreen } from "./leader-meeting-screen";
import { useCallback, useEffect, useState, useRef, type FormEvent } from "react";
type Policy = { id: string; title: string; bodyMarkdown: string };
type Account = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  firstLoginRequired: boolean;
  organizationMemberships?: { organizationId: string; role: string; organization?: { name: string } }[];
  staffAssignments?: { role: string; revokedAt: string | null }[];
};
type Session = {
  user: Account;
  policy: Policy | null;
  consentRequired: boolean;
  sessionAcknowledgementRequired: boolean;
  assignments: {
    activityId: string;
    role: string;
    activity: { name: string };
  }[];
  memberships: {
    organizationId: string;
    role: string;
    organization: { name: string; activityId: string };
  }[];
};
export function Portal() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState("總覽");
  const [registrationFocusEventId, setRegistrationFocusEventId] = useState<string | undefined>();
  const [registrationFocusUnitId, setRegistrationFocusUnitId] = useState<string | undefined>();
  const [selectedActivity, setSelectedActivity] = useState("");
  const [entryMode, setEntryMode] = useState<"staff" | "leader">("leader");
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [legalType, setLegalType] = useState<"PRIVACY" | "TERMS" | null>(null);
  const [meetingEditMode, setMeetingEditMode] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const refresh = useCallback(async (options?: { throwOnError?: boolean }) => {
    try {
      const current = await api<Session>("auth/me");
      setSession(current);
      setAccountOpen(false);
      const checkInOnly = current.assignments.some((item) => item.role === "CHECKIN_EXPORT") && !current.assignments.some((item) => item.role !== "CHECKIN_EXPORT") && current.memberships.length === 0;
      if (checkInOnly) setPage("檢錄與匯出");
      return true;
    } catch (cause) {
      setSession(null);
      setAccountOpen(false);
      setPage("總覽");
      setSelectedActivity("");
      if (options?.throwOnError) throw cause;
      return false;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!accountOpen) return;
    const onPointer = (event: MouseEvent) => { if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setAccountOpen(false); };
    document.addEventListener("mousedown", onPointer); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [accountOpen]);
  async function action(run: () => Promise<unknown>, options?: { throwOnRefreshError?: boolean }) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
      const refreshed = await refresh({ throwOnError: options?.throwOnRefreshError });
      if (refreshed || !options?.throwOnRefreshError) setNotice("已完成");
    } catch (e) {
      setError(e instanceof Error ? e.message : "無法完成要求");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true); setError(""); setNotice("");
    try { await api("auth/logout", "POST", {}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "登出服務暫時無法連線"); }
    finally { setSession(null); setAccountOpen(false); setPage("總覽"); setSelectedActivity(""); setBusy(false); }
  }
  function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    void action(
      () =>
        api("auth/login", "POST", {
          email: value(form, "email"),
          password: value(form, "password"),
          entryMode,
        }),
      { throwOnRefreshError: true },
    );
  }
  const activityId =
    selectedActivity ||
    session?.assignments[0]?.activityId ||
    session?.memberships[0]?.organization.activityId ||
    "";
  const admin = session?.assignments.find(
    (a) => a.activityId === activityId && a.role === "SYSTEM_ADMIN",
  );
  const staff =
    session?.assignments.some(
      (a) =>
        a.activityId === activityId &&
        ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"].includes(a.role),
    ) ?? false;
  const checkIn =
    session?.assignments.some(
      (a) => a.activityId === activityId && a.role === "CHECKIN_EXPORT",
    ) ?? false;
  const hasClub =
    session?.memberships.some(
      (m) => m.organization.activityId === activityId,
    ) ?? false;
  const navGroups = checkIn && !admin && !staff && !hasClub
    ? [{ title: "05 檢錄與匯出", items: ["檢錄與匯出"] }]
    : [
        ...(admin ? [
          { title: "01 建立高康盃", items: ["年度設定", "聯隊規則設定", "賽事項目設定", "報名費設定"] },
          { title: "02 參賽管理", items: ["社團與帳號", "選手名單", "聯隊管理"] },
          { title: "03 報名管理", items: ["報名審核", "繳費管理"] },
          { title: "04 領隊會議", items: ["會議作業", "會後異動"] },
          { title: "05 檢錄與匯出", items: ["檢錄與匯出"] },
          { title: "06 法務管理", items: ["法務文件管理"] },
        ] : []),
        ...(hasClub ? [
          { title: "01 準備參賽", items: ["選手名單", "聯隊合作"] },
          { title: "02 完成報名", items: ["賽事與人力", "費用與送出", "審核結果"] },
          { title: "03 領隊會議", items: ["領隊會議"] },
          { title: "04 最終參賽資料", items: ["最終參賽資料"] },
        ] : []),
        ...(staff && !admin ? [
          { title: "03 報名管理", items: ["選手名單", "賽事項目設定", "報名審核", "費用管理"] },
          { title: "04 領隊會議", items: ["財務核對"] },
        ] : []),
        ...(checkIn && !admin ? [{ title: "05 檢錄與匯出", items: ["檢錄與匯出"] }] : []),
      ];
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const navGroupKey = navGroups.map((group) => group.title).join("|");
  useEffect(() => {
    setOpenGroups((current) => {
      const next: Record<string, boolean> = {};
      for (const group of navGroups) next[group.title] = current[group.title] ?? false;
      return next;
    });
  }, [navGroupKey]);
  useEffect(() => {
    const activeGroup = navGroups.find((group) => group.items.includes(page));
    if (!activeGroup) return;
    setOpenGroups((current) => current[activeGroup.title] ? current : { ...current, [activeGroup.title]: true });
  }, [page, navGroupKey]);
  function navigate(nextPage: string) {
    setMeetingEditMode(false);
    setPage(nextPage);
    setAccountOpen(false);
    const group = navGroups.find((candidate) => candidate.items.includes(nextPage));
    if (group) setOpenGroups((current) => ({ ...current, [group.title]: true }));
  }
  function navigateRegistration(eventId?: string, unitId?: string) {
    setRegistrationFocusEventId(eventId);
    setRegistrationFocusUnitId(unitId);
    navigate("賽事與人力");
  }
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/">
          高康盃報名系統
        </a>
        {session && (
          <div className="identity" ref={accountRef}>
            <button className="account-button" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>{session.user.displayName} ▾</button>
            <button className="secondary" disabled={busy} onClick={() => void logout()}>登出</button>
            {accountOpen && <div className="account-menu"><p>{session.user.email}</p><button onClick={() => { setPasswordOpen(true); setAccountOpen(false); }}>修改密碼</button></div>}
          </div>
        )}
      </header>
      <main id="main" className={session && !loading && !session.user.firstLoginRequired && !session.consentRequired && !session.sessionAcknowledgementRequired ? "workspace-main" : undefined}>
        {error && (
          <div role="alert" className="alert error">
            {error}
            <div className="alert-actions"><button className="secondary" onClick={() => void refresh()}>重新整理</button><button type="button" className="alert-dismiss" aria-label="關閉錯誤訊息" onClick={() => setError("")}>關閉</button></div>
          </div>
        )}
        {notice && (
          <div role="status" className="alert success">
            {notice}
            <button type="button" className="alert-dismiss" aria-label="關閉成功訊息" onClick={() => setNotice("")}>關閉</button>
          </div>
        )}
        {loading ? (
          <section className="card" aria-busy="true">
            正在載入您的高康盃工作區…
          </section>
        ) : !session ? (
          <div className="welcome">
            <ParticleBackdrop />
            <section>
              <img className="welcome-logo" src="/brand/kangkan-logo.png" alt="高康盃官方標誌" />
              <p className="eyebrow">2026 高康盃報名系統</p><h1>高康盃報名就在這裡！</h1>
              <p className="lead">本系統由中華康樂輔導聯盟建置</p>
              <p className="brand-slogan">傳承康輔，回饋世界</p>
            </section>
            <form className="card login" onSubmit={login}>
              <h2>登入報名系統</h2>
              <div className="entry-choice" role="group" aria-label="選擇登入入口">
                <button type="button" className={entryMode === "staff" ? "entry-option active" : "entry-option"} onClick={() => setEntryMode("staff")}>我是主辦單位</button>
                <button type="button" className={entryMode === "leader" ? "entry-option active" : "entry-option"} onClick={() => setEntryMode("leader")}>我是領隊／副領隊</button>
              </div>
              <p>{entryMode === "staff" ? "主辦單位處理賽事設定、報名審核、財務與檢錄。" : "領隊與副領隊在此管理名單、報名與隊伍。"}</p>
              <label>
                電子郵件
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                />
              </label>
              <label>
                密碼
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={256}
                />
              </label>
              <button disabled={busy}>{busy ? "登入中…" : "登入"}</button>
              <p className="muted">忘記帳號或密碼？請<a href="https://www.kfking.org/" target="_blank" rel="noreferrer">聯絡主辦單位</a>。</p>
            </form>
          </div>
        ) : session.user.firstLoginRequired ? (
          <form
            className="card narrow"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void action(() =>
                api("auth/password", "POST", {
                  currentPassword: value(form, "currentPassword"),
                  newPassword: value(form, "newPassword"),
                }),
              );
            }}
          >
            <p className="eyebrow">首次使用 · 1 / 2</p>
            <h1>設定您的新密碼</h1>
            <p>請將臨時密碼更換為至少 12 個字元的新密碼。</p>
            <label>
              目前臨時密碼
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
            </label>
            <label>
              新密碼
              <input
                name="newPassword" aria-label="新密碼"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={256}
              />
              <span className="muted" aria-hidden="true">至少 12 個字元，最多 256 個字元；可使用英文大小寫、數字與特殊符號，不強制特定字元組合。</span>
            </label>
            <button disabled={busy}>更新密碼並繼續</button>
          </form>
        ) : session.consentRequired ? (
          <form
            className="card narrow"
            onSubmit={(e) => {
              e.preventDefault();
              void action(() =>
                api("auth/consent", "POST", {
                  policyId: session.policy?.id,
                  accepted: true,
                }),
              );
            }}
          >
            <p className="eyebrow">資料使用告知 · 2 / 2</p>
            <h1>{session.policy?.title ?? "等待主辦單位設定告知事項"}</h1>
            <p className="policy">{session.policy?.bodyMarkdown}</p>
            <label className="check">
              <input type="checkbox" required />
              我已閱讀並同意上述個人資料告知事項
            </label>
            <button disabled={busy || !session.policy}>同意並進入工作區</button>
          </form>
        ) : session.sessionAcknowledgementRequired ? (
          <form className="card narrow" onSubmit={(e) => { e.preventDefault(); void action(() => api("auth/session-acknowledgement", "POST", { policyId: session.policy?.id, accepted: true })); }}>
            <p className="eyebrow">本次登入確認</p><h1>請確認本屆高康盃規範</h1><p className="policy">{session.policy?.bodyMarkdown}</p>
            <label className="check"><input type="checkbox" required />我已閱讀並同意本屆高康盃報名規範、個人資料使用及相關告知事項</label>
            <button disabled={busy || !session.policy}>同意並進入系統</button>
          </form>
        ) : (
          <div className="workspace">
            <nav aria-label="主要導覽">
              {(!checkIn || admin || staff || hasClub) && <button className={page === "總覽" ? "nav active" : "nav"} onClick={() => navigate("總覽")}>總覽</button>}
          {navGroups.map((group) => <section className="nav-group" key={group.title}><button className="nav-group-toggle" aria-expanded={openGroups[group.title] ?? false} onClick={() => setOpenGroups((current) => ({ ...current, [group.title]: !(current[group.title] ?? false) }))}><span>{group.title}</span><span aria-hidden="true">{openGroups[group.title] ? "−" : "+"}</span></button>{(openGroups[group.title] ?? false) && group.items.filter((name, index, all) => all.indexOf(name) === index).map((name) => <button className={page === name ? "nav active" : "nav"} key={name} onClick={() => navigate(name)}>{name}</button>)}</section>)}
            </nav>
            <div className="content">
              {session.assignments.length > 1 && (
                <label className="context-select">
                  年度活動
                  <select
                    value={activityId}
                    onChange={(e) => {
                      setSelectedActivity(e.target.value);
                      setPage("總覽");
                    }}
                  >
                    {session.assignments.map((a) => (
                      <option key={a.activityId} value={a.activityId}>
                        {a.activity.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="eyebrow">
                {admin?.activity.name ?? "高康盃工作區"}
              </p>
              <h1>
                {page === "總覽" ? `您好，${session.user.displayName}` : page}
              </h1>
              {page === "總覽" && (staff || hasClub) ? (
                <DashboardScreen activityId={activityId} staff={staff} admin={Boolean(admin)} hasClub={hasClub} onNavigate={navigate} />
              ) : page === "年度設定" && admin ? (
                <AnnualSettings
                  key={activityId}
                  activityId={activityId}
                />
              ) : page === "社團管理" && admin ? (
                <ClubManagement key={activityId} activityId={activityId} />
              ) : page === "選手名單" && (staff || hasClub) ? (
                <RosterScreen
                  key={activityId}
                  activityId={activityId}
                  staff={staff}
                  memberships={session.memberships}
                />
              ) : page === "社團與帳號" && admin ? (
                <Accounts activityId={admin.activityId} />
              ) : page === "法務文件管理" && admin ? (
                <LegalManagement activityId={admin.activityId} />
              ) : (page === "賽事項目設定" || page === "賽事項目" || page === "參賽項目") && (staff || hasClub) ? (
                <CompetitionScreen key={activityId} activityId={activityId} admin={Boolean(admin)} />
              ) : (page === "參賽時程" || page === "時程表") && (admin || hasClub) ? (
                admin ? <CompetitionScreen key={activityId} activityId={activityId} admin /> : <ScheduleScreen key={activityId} activityId={activityId} readOnly memberships={session.memberships.filter((m) => m.organization.activityId === activityId)} onEventOpen={(eventId) => navigateRegistration(eventId)} />
              ) : (page === "隊伍" || page === "隊伍與人力") && hasClub ? (
                <TeamsScreen key={activityId} activityId={activityId} memberships={session.memberships} />
              ) : page === "聯隊規則設定" && admin ? (
                <LeagueScreen key={activityId} activityId={activityId} admin={Boolean(admin)} memberships={session.memberships.filter((m) => m.organization.activityId === activityId)} view="rules" />
              ) : (page === "聯隊" || page === "發起聯隊" || page === "聯隊合作" || page === "聯隊規則" || page === "聯隊管理") && (admin || hasClub) ? (
                <LeagueScreen key={activityId} activityId={activityId} admin={Boolean(admin)} memberships={session.memberships.filter((m) => m.organization.activityId === activityId)} view="management" onStartRegistration={(leagueId) => navigateRegistration(undefined, "LEAGUE:" + leagueId)} />
              ) : page === "賽事與人力" && hasClub ? (
                <ScheduleScreen key={activityId} activityId={activityId} readOnly meetingMode={meetingEditMode} memberships={session.memberships.filter((m) => m.organization.activityId === activityId)} />
              ) : (page === "報名" || page === "報名流程" || page === "報名確認") && hasClub ? (
              <RegistrationScreen key={activityId} activityId={activityId} organizationId={session.memberships.find((m) => m.organization.activityId === activityId)?.organizationId} memberships={session.memberships.filter((m) => m.organization.activityId === activityId)} initialUnitId={registrationFocusUnitId} initialFocusEventId={registrationFocusEventId} onFocusConsumed={() => { setRegistrationFocusEventId(undefined); setRegistrationFocusUnitId(undefined); }} />
              ) : page === "審核結果" && hasClub ? (
                <LeaderReviewScreen key={activityId} activityId={activityId} />
              ) : page === "報名審核" && staff ? (
                <ReviewScreen key={activityId} activityId={activityId} admin={Boolean(admin)} />
              ) : (page === "費用" || page === "費用管理" || page === "繳費管理" || page === "報名費設定" || page === "費用與送出") && (staff || hasClub || admin) ? (
                <FinanceScreen key={activityId} activityId={activityId} staff={staff} admin={Boolean(admin)} leader={hasClub && !staff} settings={page === "報名費設定"} />
              ) : (page === "會議作業" || page === "會後異動") && admin ? (
                <LeaderMeetingScreen activityId={activityId} admin />
              ) : page === "財務核對" && staff && !admin ? (
                <LeaderMeetingScreen activityId={activityId} />
              ) : page === "領隊會議" && hasClub ? (
                <LeaderMeetingScreen activityId={activityId} onOpenTeams={() => { setMeetingEditMode(true); setPage("賽事與人力"); }} />
              ) : (page === "會議調整" || page === "會議後調整" || page === "會議結果") && hasClub ? (
                <section className="card"><p className="eyebrow">05 領隊會議後</p><h2>會議結果</h2><p>領隊會議結束後，請在「最終參賽資料」查看已鎖定的正式結果。</p><button onClick={() => setPage("最終參賽資料")}>查看最終參賽資料</button></section>
              ) : page === "最終參賽資料" && hasClub ? (
                <FinalPackScreen activityId={activityId} />
              ) : page === "檢錄與匯出" && (admin || checkIn) ? (
                <CheckInScreen key={activityId} activityId={activityId} admin={Boolean(admin)} />
              ) : (
                <section className="card">
                  <h2>您的工作區權限</h2>
                  {session.assignments.length + session.memberships.length ===
                  0 ? (
                    <p role="alert">目前沒有有效活動權限，請聯繫主辦單位。</p>
                  ) : (
                    <ul>
                      {session.assignments.map((a) => (
                        <li key={a.activityId}>
                          {a.activity.name} ·{" "}
                          {
                            {
                              SYSTEM_ADMIN: "系統管理員",
                              REGISTRATION_FINANCE: "報名與財務",
                              CHECKIN_EXPORT: "檢錄與匯出",
                            }[a.role]
                          }
                        </li>
                      ))}
                      {session.memberships.map((m) => (
                        <li key={m.organizationId}>
                          {m.organization.name} ·{" "}
                          {m.role === "LEADER" ? "領隊" : "副領隊"}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          </div>
        )}
      </main>
      {passwordOpen && <div className="modal-backdrop" role="presentation"><form className="card password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-title" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const next = value(form, "newPassword"); if (next !== value(form, "confirmPassword")) { setError("兩次輸入的新密碼不一致"); return; } void action(async () => { await api("auth/password", "POST", { currentPassword: value(form, "currentPassword"), newPassword: next }); setPasswordOpen(false); }); }}><h2 id="password-title">修改密碼</h2><label>目前密碼<input name="currentPassword" type="password" autoComplete="current-password" required /></label><label>新密碼<input name="newPassword" aria-label="新密碼" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /><span className="muted" aria-hidden="true">至少 12 個字元，最多 256 個字元；可使用英文大小寫、數字與特殊符號，不強制特定字元組合。</span></label><label>確認新密碼<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label><div className="button-group"><button disabled={busy}>更新密碼</button><button type="button" className="secondary" onClick={() => setPasswordOpen(false)}>取消</button></div></form></div>}
      <footer className="site-footer">
        <div className="footer-brand"><img className="footer-logo" src="/brand/kangkan-logo.png" alt="高康盃官方標誌" /><p>高康盃報名系統‧中華康樂輔導聯盟</p></div>
        <div><h2>官方資訊</h2><a href="https://www.kfking.org/" target="_blank" rel="noreferrer">官方網站</a><a href="https://www.facebook.com/KFA1999/" target="_blank" rel="noreferrer">Facebook</a><a href="https://www.instagram.com/KFA1999/" target="_blank" rel="noreferrer">Instagram</a></div>
        <div><h2>文件與政策</h2><a href="https://www.kfking.org/group/2025gao-kang-bei/discussion" target="_blank" rel="noreferrer">競賽簡章與家長同意書</a><button className="footer-link" onClick={() => setLegalType("PRIVACY")}>隱私權政策</button><button className="footer-link" onClick={() => setLegalType("TERMS")}>使用條款</button></div>
        <div><h2>服務與政策</h2><a href="https://www.kfking.org/contact" target="_blank" rel="noreferrer">聯絡我們</a><p className="footer-disclaimer">相關內容依主辦單位公告為準，並保留修改權利</p><small className="footer-copyright">© 2026 高康盃報名系統．All rights reserved.</small></div>
      </footer>
      {legalType && <LegalViewer type={legalType} onClose={() => setLegalType(null)} />}
    </div>
  );
}
function ParticleBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particles = Array.from({ length: window.innerWidth < 760 ? 24 : 48 }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - .5) * .0005, vy: (Math.random() - .5) * .0005, r: 1 + Math.random() * 2 }));
    let frame = 0;
    const resize = () => { const dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr; canvas.style.width = `${window.innerWidth}px`; canvas.style.height = `${window.innerHeight}px`; context.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const draw = () => { context.clearRect(0, 0, window.innerWidth, window.innerHeight); for (const p of particles) { p.x = (p.x + p.vx + 1) % 1; p.y = (p.y + p.vy + 1) % 1; context.fillStyle = "rgba(243,200,75,.45)"; context.beginPath(); context.arc(p.x * window.innerWidth, p.y * window.innerHeight, p.r, 0, Math.PI * 2); context.fill(); } if (!reduced) frame = requestAnimationFrame(draw); };
    resize(); draw(); window.addEventListener("resize", resize); return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className="particle-layer" aria-hidden="true" />;
}
type LegalDocument = { id: string; documentType: "PRIVACY" | "TERMS"; version: string; title: string; bodyMarkdown: string; status: "DRAFT" | "PUBLISHED"; publishedAt: string };
function LegalViewer({ type, onClose }: { type: "PRIVACY" | "TERMS"; onClose: () => void }) {
  const [doc, setDoc] = useState<LegalDocument | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { void api<LegalDocument>(`legal/${type.toLowerCase()}`).then(setDoc).catch(() => setDoc(null)).finally(() => setLoading(false)); }, [type]);
  return <div className="modal-backdrop" role="presentation"><section className="card legal-dialog" role="dialog" aria-modal="true" aria-labelledby="legal-title"><div className="section-heading"><div><p className="eyebrow">{type === "PRIVACY" ? "隱私權政策" : "使用條款"}</p><h2 id="legal-title">{doc?.title ?? (type === "PRIVACY" ? "隱私權政策" : "使用條款")}</h2></div><button className="secondary" onClick={onClose}>關閉</button></div>{loading ? <p>正在載入文件…</p> : doc ? <><p className="muted">版本 {doc.version} · {new Date(doc.publishedAt).toLocaleDateString("zh-TW")}</p><pre className="policy">{doc.bodyMarkdown}</pre></> : <p>目前尚未發布此文件。</p>}</section></div>;
}
function LegalManagement({ activityId }: { activityId: string }) {
  const [docs, setDocs] = useState<LegalDocument[]>([]); const [form, setForm] = useState({ documentType: "PRIVACY" as "PRIVACY" | "TERMS", title: "隱私權政策", version: "v1", bodyMarkdown: "" }); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const load = useCallback(async () => { try { setDocs(await api<LegalDocument[]>(`activities/${activityId}/legal`)); } catch (e) { setError(e instanceof Error ? e.message : "無法載入法務文件"); } }, [activityId]);
  useEffect(() => { void load(); }, [load]);
  async function create(e: FormEvent) { e.preventDefault(); setError(""); try { await api(`activities/${activityId}/legal`, "POST", form); setNotice("草稿已建立"); await load(); } catch (e) { setError(e instanceof Error ? e.message : "無法建立草稿"); } }
  async function publish(id: string) { setError(""); try { await api(`activities/${activityId}/legal/${id}/publish`, "POST", {}); setNotice("文件已發布"); await load(); } catch (e) { setError(e instanceof Error ? e.message : "無法發布文件"); } }
  return <><section className="card"><p className="eyebrow">06 法務管理</p><h2>法務文件管理</h2><p className="muted">你可以在這裡更新隱私權政策與使用條款。發布前只有主辦單位看得到草稿；發布後，使用者會看到最新版本，舊版本也會保留下來。</p>{error && <p role="alert" className="alert error">{error}</p>}{notice && <p role="status" className="alert success">{notice}</p>}<form onSubmit={(e) => { void create(e); }}><div className="formgrid"><label>文件類型<select value={form.documentType} onChange={e => setForm({ ...form, documentType: e.target.value as "PRIVACY" | "TERMS", title: e.target.value === "PRIVACY" ? "隱私權政策" : "使用條款" })}><option value="PRIVACY">隱私權政策</option><option value="TERMS">使用條款</option></select></label><label>版本<input value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} required maxLength={40} /><span className="muted">例如 v1、2026.1；最多 40 字，可使用英數、點、底線與連字號。</span></label><label>標題<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required maxLength={160} /></label></div><label>內容<textarea rows={10} value={form.bodyMarkdown} onChange={e => setForm({ ...form, bodyMarkdown: e.target.value })} required maxLength={20000} /><span className="muted">最多 20,000 字；保留換行與段落，不支援 HTML 或可執行內容。</span></label><button>建立草稿</button></form></section><section className="card"><h2>版本紀錄</h2>{docs.length === 0 ? <p>尚未建立法務文件。</p> : <ul>{docs.map(doc => <li key={doc.id}><strong>{doc.documentType === "PRIVACY" ? "隱私權政策" : "使用條款"} · {doc.version}</strong> · {doc.status === "PUBLISHED" ? "已發布" : "草稿"}{doc.status === "DRAFT" && <button className="secondary" onClick={() => void publish(doc.id)}>發布</button>}</li>)}</ul>}</section></>;
}
function FinalPackScreen({ activityId }: { activityId: string }) {
  const [data, setData] = useState<{ available: boolean; message?: string; rows?: { participant: string; sourceClub: string; grade: string; gender: string; event: string; team: string }[] }>({ available: false });
  useEffect(() => { void api<typeof data>(`activities/${activityId}/final-pack`).then(setData).catch(() => setData({ available: false, message: "領隊會議後將在此提供最終參賽資料" })); }, [activityId]);
  return <section className="card"><h2>最終參賽資料</h2>{!data.available ? <p>{data.message ?? "領隊會議尚未完成，最終參賽資料尚未鎖定"}</p> : <><p>目前共 {data.rows?.length ?? 0} 筆最終參賽配置。</p><a className="button" href={`/api/activities/${activityId}/final-pack/participants.xlsx`}>下載最終參賽選手 XLSX</a><button className="secondary" onClick={() => window.print()}>列印／儲存 PDF</button><div className="tablewrap"><table><thead><tr><th>選手</th><th>來源社團</th><th>年級</th><th>性別</th><th>賽事項目</th><th>隊伍</th></tr></thead><tbody>{(data.rows ?? []).map((row, index) => <tr key={`${row.participant}-${index}`}><td>{row.participant}</td><td>{row.sourceClub}</td><td>{row.grade}</td><td>{row.gender}</td><td>{row.event}</td><td>{row.team}</td></tr>)}</tbody></table></div></>}</section>;
}
function Accounts({ activityId }: { activityId: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Account | null>(null);
  const [bulkPreview, setBulkPreview] = useState<{ total: number; valid: number; invalid: number; errors: { row: number; message: string }[]; canCommit: boolean; fingerprint: string; rows?: unknown[] } | null>(null);
  const [bulkResult, setBulkResult] = useState<{ file: { name: string; mime: string; base64: string }; count: number } | null>(null);
  const [bulkRows, setBulkRows] = useState<unknown[]>([]);
  const [bulkFileName, setBulkFileName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const load = useCallback(async () => {
    try {
      setAccounts(await api<Account[]>(`activities/${activityId}/accounts`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "無法載入帳號");
    } finally {
      setLoading(false);
    }
  }, [activityId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function run(path: string, method: string, body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, method, body);
      setNotice("帳號資料已更新");
      setSelected(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失敗");
    } finally {
      setBusy(false);
    }
  }
  const base = `activities/${activityId}/accounts`;
  function showBulkCredentials(result: { file: { name: string; mime: string; base64: string }; count: number }) { setBulkResult(result); download(result.file); }
  async function commitBulk() { if (!bulkPreview) return; try { const result = await api<{ file: { name: string; mime: string; base64: string }; count: number }>(`${base}/bulk-commit`, "POST", { rows: bulkRows, fingerprint: bulkPreview.fingerprint }); showBulkCredentials(result); setBulkPreview(null); await load(); } catch (e) { setError(e instanceof Error ? e.message : "匯入建立失敗"); } }
  async function handleFile(file?: File) {
    if (!file) return;
    setError("");
    setBulkFileName(file.name);
    if (!/\.xlsx$/i.test(file.name)) { setError("請選擇 XLSX 範本檔"); return; }
    if (file.size > 10 * 1024 * 1024) { setError("僅接受 .xlsx，檔案上限 10 MB，單次最多 100 個社團。"); return; }
    try {
      const bytes = await file.arrayBuffer();
      let binary = "";
      new Uint8Array(bytes).forEach((byte) => { binary += String.fromCharCode(byte); });
      const preview = await api<{ total: number; valid: number; invalid: number; errors: { row: number; message: string }[]; canCommit: boolean; fingerprint: string; rows?: unknown[] }>(`${base}/bulk-preview-file`, "POST", { name: file.name, mime: file.type, base64: btoa(binary) });
      setBulkRows(preview.rows ?? []);
      setBulkResult(null);
      setBulkPreview(preview);
    } catch (e) { setError(e instanceof Error ? e.message : "XLSX 匯入預覽失敗"); }
  }
  async function singleCreate(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = e.currentTarget; const row = { clubCode: value(f, "clubCode"), clubName: value(f, "clubName"), clubShortName: value(f, "clubShortName") || null, leaderName: value(f, "leaderName"), leaderEmail: value(f, "leaderEmail"), deputyName: value(f, "deputyName") || null, deputyEmail: value(f, "deputyEmail") || null }; try { const preview = await api<{ canCommit: boolean; fingerprint: string }>(`${base}/bulk-preview`, "POST", { rows: [row] }); if (!preview.canCommit) throw new Error("單筆資料未通過檢查"); const result = await api<{ file: { name: string; mime: string; base64: string }; count: number }>(`${base}/bulk-commit`, "POST", { rows: [row], fingerprint: preview.fingerprint }); showBulkCredentials(result); await load(); f.reset(); } catch (e) { setError(e instanceof Error ? e.message : "建立社團失敗"); } }
  const leaderAccounts = accounts.filter((a) => (a.organizationMemberships?.length ?? 0) > 0);
  const staffAccounts = accounts.filter((a) => (a.organizationMemberships?.length ?? 0) === 0);
  const selectedIsClubAccount = Boolean(selected?.organizationMemberships?.length);
  return (
    <>
      <p>Excel 匯入會先預覽並逐列驗證，確認後一次建立。</p>
      <section className="card"><h2>建立社團與領隊帳號</h2><p className="muted">帳號格式為 Email，亦為登入報名系統使用的帳號。</p><a className="button-link" href={`/api/${base}/bulk-template`}>下載 XLSX 匯入範本</a><label className={dragActive ? "dropzone drag-active" : "dropzone"} aria-label="拖放或選擇 XLSX 匯入檔案" onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; setDragActive(true); }} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }} onDragLeave={(e) => { e.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragActive(false); }} onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragActive(false); const files = e.dataTransfer.files; if (files.length !== 1) { setError("一次只能匯入一個 XLSX 檔案"); return; } void handleFile(files[0]); }}><span>拖放 XLSX 到此處，或選擇檔案</span>{bulkFileName && <strong className="dropzone-file-name" role="status">已選擇檔案：{bulkFileName}</strong>}<input aria-label="選擇 XLSX 匯入檔案" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const selected = e.currentTarget.files?.[0]; e.currentTarget.value = ""; void handleFile(selected); }} /></label>{dragActive && <p className="muted" role="status" aria-live="polite">放開滑鼠即可上傳 XLSX。</p>}<p className="muted">僅接受 .xlsx，檔案上限 10 MB，單次最多 100 個社團。<br />匯入前會先預覽並逐列檢查，確認後才會建立帳號。</p>{bulkPreview && <div role="status"><p>{bulkPreview.total} 筆資料：{bulkPreview.valid} 筆可建立、{bulkPreview.invalid} 筆錯誤。</p>{bulkPreview.errors.map(error => <p key={error.row}>第 {error.row} 列：{error.message}</p>)}{bulkPreview.canCommit && <button onClick={() => void commitBulk()} disabled={busy}>確認建立並產生一次性帳密</button>}</div>}{bulkResult && <div role="status"><p>已建立 {bulkResult.count} 個帳號。臨時密碼只提供本次下載，遺失時請用帳號管理重設。</p><button onClick={() => download(bulkResult.file)}>下載一次性臨時帳密 XLSX</button></div>}</section>
      <section className="card collapsible-card"><details><summary>單筆建立社團</summary><form onSubmit={(e) => void singleCreate(e)}><div className="formgrid"><label>社團代碼<input name="clubCode" required maxLength={30} /></label><label>社團名稱<input name="clubName" required /></label><label>社團簡稱<input name="clubShortName" /></label><label>領隊姓名<input name="leaderName" required /></label><label>領隊帳號<input name="leaderEmail" aria-label="領隊帳號" type="email" required /><span className="muted">帳號格式為 Email，亦為登入報名系統使用的帳號。</span></label><label>副領隊姓名<input name="deputyName" /></label><label>副領隊帳號<input name="deputyEmail" aria-label="副領隊帳號" type="email" /><span className="muted">帳號格式為 Email，亦為登入報名系統使用的帳號。</span></label></div><button disabled={busy}>預覽並建立社團</button></form></details></section>
      {error && (
        <div role="alert" className="alert error">
          {error}
          <div className="alert-actions"><button className="secondary" onClick={() => void load()}>重試</button><button type="button" className="alert-dismiss" aria-label="關閉錯誤訊息" onClick={() => setError("")}>關閉</button></div>
        </div>
      )}
      {notice && (
        <div role="status" className="alert success">
          {notice}
          <button type="button" className="alert-dismiss" aria-label="關閉成功訊息" onClick={() => setNotice("")}>關閉</button>
        </div>
      )}
      <section className="card collapsible-card"><details><summary>建立工作人員帳號</summary><form
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          void run(base, "POST", {
            email: value(f, "email"),
            displayName: value(f, "displayName"),
            temporaryPassword: value(f, "temporaryPassword"),
            assignment: { kind: "staff", role: value(f, "role") },
          });
        }}
      >
        <h2>建立工作人員帳號</h2>
        <div className="formgrid">
          <label>
            姓名
            <input name="displayName" required maxLength={120} />
          </label>
          <label>
            電子郵件
            <input name="email" type="email" required />
          </label>
          <label>
            角色
            <select name="role">
              <option value="REGISTRATION_FINANCE">報名與財務</option>
              <option value="CHECKIN_EXPORT">檢錄與匯出</option>
              <option value="SYSTEM_ADMIN">系統管理員</option>
            </select>
          </label>
          <label>
            臨時密碼
            <input
              name="temporaryPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
            />
          </label>
        </div>
        <button disabled={busy}>建立帳號</button>
      </form></details></section>
      <section className="card">
        <h2>帳號清單</h2>
        {loading ? (
          <p aria-busy="true">載入中…</p>
        ) : !accounts.length ? (
          <p>尚無帳號，請先建立。</p>
        ) : (
          <div className="account-groups"><details><summary>領隊端帳號（{leaderAccounts.length}）</summary><div className="tablewrap"><table><thead><tr><th>社團</th><th>姓名</th><th>角色</th><th>電子郵件</th><th>狀態</th><th>操作</th></tr></thead><tbody>{leaderAccounts.map((a) => <tr key={a.id}><td>{a.organizationMemberships?.map((m) => m.organization?.name ?? m.organizationId).join("、")}</td><td>{a.displayName}</td><td>{a.organizationMemberships?.map((m) => m.role === "LEADER" ? "領隊" : "副領隊").join("、")}</td><td>{a.email}</td><td>{a.status === "ACTIVE" ? "啟用" : "停用"}{a.firstLoginRequired && " · 待改密碼"}</td><td><button className="secondary" onClick={() => setSelected(a)}>管理帳號</button></td></tr>)}</tbody></table></div></details><details><summary>主辦端帳號（{staffAccounts.length}）</summary><div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>電子郵件</th>
                  <th>角色</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {staffAccounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.displayName}</td>
                    <td>{a.email}</td>
                    <td>{a.staffAssignments?.map((s) => ({ SYSTEM_ADMIN: "系統管理員", REGISTRATION_FINANCE: "報名與財務", CHECKIN_EXPORT: "檢錄與匯出" }[s.role] ?? s.role)).join("、")}</td>
                    <td>
                      {a.status === "ACTIVE" ? "啟用" : "停用"}
                      {a.firstLoginRequired && " · 待改密碼"}
                    </td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => setSelected(a)}
                      >
                        管理帳號
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div></details></div>
        )}
      </section>
      {selected && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const mode = value(f, "mode");
            void run(
              base +
                "/" +
                selected.id +
                (mode === "reset"
                  ? "/reset-password"
                  : mode === "role"
                    ? "/assignment"
                    : ""),
              mode === "status" ? "PATCH" : "POST",
              mode === "reset"
                ? {
                    temporaryPassword: value(f, "temporaryPassword"),
                    reason: value(f, "reason"),
                  }
                : mode === "role"
                  ? {
                      assignment: { kind: "staff", role: value(f, "role") },
                      revoked: value(f, "revoked") === "yes",
                      reason: value(f, "reason"),
                    }
                  : {
                      status:
                        selected.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                      reason: value(f, "reason"),
                    },
            );
          }}
        >
          <h2>管理 {selected.displayName}</h2>
          <label>
            操作
            <select name="mode">
              <option value="status">
                {selected.status === "ACTIVE" ? "停用帳號" : "啟用帳號"}
              </option>
              <option value="reset">重設臨時密碼</option>
              {!selectedIsClubAccount && <option value="role">更新工作人員權限</option>}
            </select>
          </label>
          <label>
            新臨時密碼（重設時必填）
            <input
              name="temporaryPassword"
              type="password"
              autoComplete="new-password"
            />
          </label>
          {!selectedIsClubAccount && <><label>
            工作人員角色
            <select name="role">
              <option value="REGISTRATION_FINANCE">報名與財務</option>
              <option value="CHECKIN_EXPORT">檢錄與匯出</option>
              <option value="SYSTEM_ADMIN">系統管理員</option>
            </select>
          </label>
          <label>
            權限狀態
            <select name="revoked">
              <option value="no">授予權限</option>
              <option value="yes">撤銷權限</option>
            </select>
          </label></>}
          {selectedIsClubAccount && <p className="muted">領隊端帳號僅可停用／啟用或重設臨時密碼；社團角色由社團會員關係管理。</p>}
          <label>
            操作原因
            <textarea name="reason" required maxLength={1000} />
          </label>
          <button disabled={busy}>確認操作</button>
          <button
            type="button"
            className="secondary"
            onClick={() => setSelected(null)}
          >
            取消
          </button>
        </form>
      )}
    </>
  );
}
