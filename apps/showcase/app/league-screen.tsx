"use client";
import { demoNow } from "./demo-state";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, value } from "./client";
import { Feedback } from "./shared";

type Club = { id: string; name: string; code: string; active: boolean };
type Member = { id: string; organizationId: string; status: string; organization: Club };
type Event = { id: string; code: string; name: string; enabled: boolean; allowLeague: boolean };
type ClubQualification = { eligible: boolean; participantCount: number; genderCounts: { male: number; female: number }; minorityGenderRatio: number; checks: { code: string; passed: boolean; message: string }[]; blockers: { message: string }[] };
type Rule = { activityId: string; id?: string | null; minimumMemberClubs: number; maximumMemberClubs: number | null; minimumParticipants: number | null; maximumParticipants: number | null; lowParticipantQualificationEnabled: boolean; lowParticipantThreshold: number | null; genderImbalanceQualificationEnabled: boolean; minorityGenderRatioPercent: number | null; qualificationMode: "ANY" | "ALL"; singleGenderExceptionEnabled: boolean; singleGenderExceptionMaximumMemberClubs: number | null; singleGenderExceptionMaximumParticipants: number | null; rowVersion: number };
type League = { id: string; name: string; ownerOrganizationId: string; rowVersion: number; status: string; members: Member[]; eligibility: { eligible: boolean; blockers: { code?: string; message: string }[]; participantCount: number; confirmedMemberCount: number; maximumMemberClubs: number | null; maximumParticipants: number | null; singleGenderMemberClubs: string[] } };
type LeagueView = "rules" | "management";
type ActivityDates = { registrationOpensAt: string | null; registrationClosesAt: string | null };

export function LeagueScreen({ activityId, admin, memberships, view = "management", onStartRegistration }: { activityId: string; admin: boolean; memberships: { organizationId: string }[]; view?: LeagueView; onStartRegistration?: (leagueId: string) => void }) {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [rule, setRule] = useState<Rule | null>(null);
  const [clubQualification, setClubQualification] = useState<ClubQualification | null>(null);
  const [selected, setSelected] = useState<League | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<ActivityDates | null>(null);
  const [editingRule, setEditingRule] = useState(false);
  const [leagueRegistrationIds, setLeagueRegistrationIds] = useState<Set<string>>(new Set());
  const [createRequest, setCreateRequest] = useState<{ name: string; ownerOrganizationId: string } | null>(null);
  const [editRequest, setEditRequest] = useState<{ id: string; name: string; rowVersion: number } | null>(null);
  const [joinRequest, setJoinRequest] = useState<Member | null>(null);
  const memberOrganizationId = memberships[0]?.organizationId;

  const load = useCallback(async () => {
    try {
      const [c, l, e, r, a, registrations] = await Promise.all([
        api<Club[]>(`activities/${activityId}/clubs`),
        api<League[]>(`activities/${activityId}/leagues`),
        api<Event[]>(`activities/${activityId}/events`),
        api<Rule>(`activities/${activityId}/league-rule`),
        api<ActivityDates>(`activities/${activityId}`),
        api<{ leagueId: string | null }[]>(`activities/${activityId}/registrations`).catch(() => []),
      ]);
      setClubs(c);
      setLeagues(l);
      setEvents(e);
      setRule(r);
      setActivity(a);
      setLeagueRegistrationIds(new Set(registrations.flatMap((item) => item.leagueId ? [item.leagueId] : [])));
      setEditingRule((current) => current || !r.id);
      if (memberOrganizationId) setClubQualification(await api<ClubQualification>(`activities/${activityId}/clubs/${memberOrganizationId}/league-qualification`));
      else setClubQualification(null);
      if (selected) setSelected(l.find((x) => x.id === selected.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "無法載入聯隊");
    }
  }, [activityId, memberOrganizationId, selected?.id]);

  useEffect(() => { void load(); }, [load]);

  async function run(path: string, method: string, body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<League>(path, method, body);
      if (result?.id) setSelected(result);
      setNotice("聯隊資料已更新");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失敗");
    } finally {
      setBusy(false);
    }
  }

  async function withdrawLeague(league: League) {
    if (!window.confirm("撤銷後本年度聯隊申請將停止使用，確定要撤銷嗎？")) return;
    await run(`leagues/${league.id}`, "DELETE", { rowVersion: league.rowVersion, reason: "撤銷聯隊申請" });
  }

  async function updateRule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!rule) return;
    const f = e.currentTarget;
    const checked = (name: string) => new FormData(f).get(name) === "on";
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await api<Rule>(`activities/${activityId}/league-rule`, "PATCH", {
        minimumMemberClubs: Number(value(f, "minimumMemberClubs")),
        maximumMemberClubs: checked("maximumMemberClubsUnlimited") ? null : Number(value(f, "maximumMemberClubs")),
        minimumParticipants: value(f, "minimumParticipants") ? Number(value(f, "minimumParticipants")) : null,
        maximumParticipants: value(f, "maximumParticipants") ? Number(value(f, "maximumParticipants")) : null,
        lowParticipantQualificationEnabled: checked("lowParticipantQualificationEnabled"),
        lowParticipantThreshold: checked("lowParticipantQualificationEnabled") ? Number(value(f, "lowParticipantThreshold")) : null,
        genderImbalanceQualificationEnabled: checked("genderImbalanceQualificationEnabled"),
        minorityGenderRatioPercent: checked("genderImbalanceQualificationEnabled") ? Number(value(f, "minorityGenderRatioPercent")) : null,
        qualificationMode: value(f, "qualificationMode"),
        singleGenderExceptionEnabled: checked("singleGenderExceptionEnabled"),
        singleGenderExceptionMaximumMemberClubs: checked("singleGenderExceptionMaximumMemberClubsUnlimited") ? null : Number(value(f, "singleGenderExceptionMaximumMemberClubs")),
        singleGenderExceptionMaximumParticipants: checked("singleGenderExceptionEnabled") ? Number(value(f, "singleGenderExceptionMaximumParticipants")) : null,
        rowVersion: rule.rowVersion,
        reason: "更新聯隊規則",
      });
      setRule(updated);
      setEditingRule(false);
      setNotice("聯隊規則已更新");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "無法更新聯隊規則");
    } finally {
      setBusy(false);
    }
  }

  const own = memberships.map((m) => m.organizationId);
  const pendingInitiated = leagues.some((league) => own.includes(league.ownerOrganizationId) && league.status !== "DISSOLVED" && league.members.some((member) => member.status === "PENDING"));
  const existingActiveLeague = leagues.find((league) => league.status !== "DISSOLVED" && league.members.some((member) => own.includes(member.organizationId)));
  const noActiveParticipants = clubQualification?.participantCount === 0;
  const clubReadyToInitiate = Boolean(clubQualification && clubQualification.participantCount > 0 && clubQualification.eligible);
  const available = clubs.filter((c) => c.active && c.id !== selected?.ownerOrganizationId && !selected?.members.some((m) => m.organizationId === c.id));
  const ownsSelected = Boolean(selected && own.includes(selected.ownerOrganizationId));
  const selectedOwnerName = selected?.members.find((member) => member.organizationId === selected.ownerOrganizationId)?.organization.name ?? "未指定";
  const selectedConfirmedCount = selected?.eligibility.confirmedMemberCount ?? selected?.members.filter((member) => member.status === "CONFIRMED").length ?? 0;
  const selectedDissolved = selected?.status === "DISSOLVED";
  const selectedEligible = Boolean(selected && !selectedDissolved && selected.eligibility.eligible);
  const selectedNextStep = selected ? selectedDissolved ? "此聯隊申請已撤銷。" : selected.eligibility.eligible ? "可選擇可使用的賽事項目並完成報名。" : selected.members.some((member) => member.status === "PENDING") ? "請由各成員社團完成確認。" : selected.eligibility.blockers[0]?.message ?? "請依資格提示補齊成員或有效選手。" : "";
  const showRules = view === "rules";
  if (showRules) {
    return <>
    <Feedback busy={busy} error={error} notice={notice} />
    {admin && rule ? (<section className="card">
        <p className="eyebrow">年度設定 · 聯隊資格</p>
        <h2>聯隊規則設定</h2>
        <p className="muted">這裡設定「本年度哪些社團可以組聯隊」；儲存後既有聯隊會重新評估，不會被刪除。實際建立、邀請與確認請到「聯隊管理」。</p>
         {!editingRule && rule.id ? <div className="league-rule-summary"><p><strong>本年度聯隊規則已儲存</strong></p><div className="league-rule-summary-grid"><section className="league-rule-summary-card"><h3>基本聯隊規模</h3><p>最低 {rule.minimumMemberClubs} 個社團</p><p>{rule.maximumMemberClubs === null ? "最多社團數：不設上限" : `最多 ${rule.maximumMemberClubs} 個社團`}</p></section><section className="league-rule-summary-card"><h3>一般聯隊參賽規模</h3><p>{rule.minimumParticipants === null ? "至少參賽選手：未設定" : `至少 ${rule.minimumParticipants} 位`}</p><p>{rule.maximumParticipants === null ? "最多參賽選手：未設定" : `最多 ${rule.maximumParticipants} 位`}</p></section><section className="league-rule-summary-card"><h3>特殊資格</h3><p>{rule.lowParticipantQualificationEnabled ? `小社團資格 · 啟用 · ≤ ${rule.lowParticipantThreshold ?? "未設定"} 位` : "小社團資格 · 未啟用"}</p><p>{rule.genderImbalanceQualificationEnabled ? `性別比例資格 · 啟用 · ${rule.minorityGenderRatioPercent ?? "未設定"}%` : "性別比例資格 · 未啟用"}</p></section><section className="league-rule-summary-card"><h3>資格判定</h3><p>{rule.qualificationMode === "ALL" ? "符合全部特殊資格條件" : "符合其中任一特殊資格條件"}</p></section><section className="league-rule-summary-card"><h3>單一性別社團例外</h3><p>{rule.singleGenderExceptionEnabled ? "啟用" : "未啟用"}</p>{rule.singleGenderExceptionEnabled && <p>{rule.singleGenderExceptionMaximumMemberClubs === null ? "社團數不設上限" : `最多 ${rule.singleGenderExceptionMaximumMemberClubs} 個社團`} · {rule.singleGenderExceptionMaximumParticipants === null ? "選手數不設上限" : `最多 ${rule.singleGenderExceptionMaximumParticipants} 位參賽選手`}</p>}</section></div>{activity?.registrationOpensAt && new Date(demoNow()) >= new Date(activity.registrationOpensAt) ? <p className="lock-banner">報名已開始，本年度聯隊規則已鎖定。</p> : <button type="button" className="secondary" onClick={() => setEditingRule(true)}>編輯聯隊規則</button>}</div> : <form className="league-rule-form" onSubmit={(e) => void updateRule(e)}>
        <div className="league-rule-editor">
          <fieldset className="league-rule-group"><legend>基本聯隊規模</legend><div className="league-rule-fields">
            <div className="rule-field"><label htmlFor="minimumMemberClubs">最低參與社團數</label><input id="minimumMemberClubs" name="minimumMemberClubs" type="number" min="2" required defaultValue={rule.minimumMemberClubs} /><span className="league-rule-help">一個聯隊至少需要幾個社團確認加入，才符合成立條件。</span></div>
            <div className="rule-field"><label htmlFor="maximumMemberClubs">一般聯隊最多社團數</label><input id="maximumMemberClubs" name="maximumMemberClubs" type="number" min="2" required={rule.maximumMemberClubs !== null} defaultValue={rule.maximumMemberClubs ?? ""} /><label className="check rule-toggle"><input name="maximumMemberClubsUnlimited" type="checkbox" defaultChecked={rule.maximumMemberClubs === null} />不設上限</label></div>
          </div></fieldset>
          <fieldset className="league-rule-group"><legend>一般聯隊參賽規模</legend><div className="league-rule-fields">
            <div className="rule-field"><label htmlFor="minimumParticipants">一般聯隊至少實際參賽選手</label><input id="minimumParticipants" name="minimumParticipants" type="number" min="0" defaultValue={rule.minimumParticipants ?? ""} /><span className="league-rule-help">留白表示不設定下限。</span></div>
            <div className="rule-field"><label htmlFor="maximumParticipants">一般聯隊最多實際參賽選手</label><input id="maximumParticipants" name="maximumParticipants" type="number" min="0" defaultValue={rule.maximumParticipants ?? ""} /><span className="league-rule-help">留白表示不設定上限。</span></div>
          </div></fieldset>
          <fieldset className="league-rule-group"><legend>特殊資格條件</legend><div className="league-rule-fields">
            <div className="rule-field"><label htmlFor="lowParticipantThreshold">小社團門檻</label><input id="lowParticipantThreshold" name="lowParticipantThreshold" type="number" min="0" required={rule.lowParticipantQualificationEnabled} defaultValue={rule.lowParticipantThreshold ?? ""} /><span className="league-rule-help">有效選手數小於或等於此值的社團，可依小社團條件取得聯隊資格。</span><label className="check rule-toggle"><input name="lowParticipantQualificationEnabled" type="checkbox" defaultChecked={rule.lowParticipantQualificationEnabled} />啟用小社團資格</label></div>
            <div className="rule-field"><label htmlFor="minorityGenderRatioPercent">男女比例資格門檻</label><input id="minorityGenderRatioPercent" name="minorityGenderRatioPercent" type="number" min="0" max="50" required={rule.genderImbalanceQualificationEnabled} defaultValue={rule.minorityGenderRatioPercent ?? ""} /><span className="league-rule-help">較少性別比例上限（百分比）。</span><label className="check rule-toggle"><input name="genderImbalanceQualificationEnabled" type="checkbox" defaultChecked={rule.genderImbalanceQualificationEnabled} />啟用性別比例資格</label></div>
          </div></fieldset>
          <fieldset className="league-rule-group"><legend>資格判定方式</legend><div className="rule-field league-rule-mode"><label htmlFor="qualificationMode">資格判定方式</label><select id="qualificationMode" name="qualificationMode" defaultValue={rule.qualificationMode}><option value="ANY">符合其中任一條件</option><option value="ALL">必須全部符合</option></select><span className="league-rule-help">選擇特殊資格條件需要符合其中一項或全部條件。</span></div></fieldset>
          <fieldset className="league-rule-group"><legend>單一性別社團例外 <label className="check league-rule-toggle"><input name="singleGenderExceptionEnabled" type="checkbox" defaultChecked={rule.singleGenderExceptionEnabled} />啟用</label></legend><div className="league-rule-fields">
            <div className="rule-field"><label htmlFor="singleGenderExceptionMaximumMemberClubs">含單一性別社團時的社團數上限</label><input id="singleGenderExceptionMaximumMemberClubs" name="singleGenderExceptionMaximumMemberClubs" type="number" min="2" required={rule.singleGenderExceptionEnabled && rule.singleGenderExceptionMaximumMemberClubs !== null} defaultValue={rule.singleGenderExceptionMaximumMemberClubs ?? ""} /><span className="league-rule-help">啟用單一性別例外時，聯隊最多可包含的已確認社團數。</span><label className="check rule-toggle"><input name="singleGenderExceptionMaximumMemberClubsUnlimited" type="checkbox" defaultChecked={rule.singleGenderExceptionMaximumMemberClubs === null} />社團數不設上限</label></div>
            <div className="rule-field"><label htmlFor="singleGenderExceptionMaximumParticipants">單一性別社團例外參賽選手上限</label><input id="singleGenderExceptionMaximumParticipants" name="singleGenderExceptionMaximumParticipants" type="number" min="0" required={rule.singleGenderExceptionEnabled} defaultValue={rule.singleGenderExceptionMaximumParticipants ?? ""} /><span className="league-rule-help">若聯隊中包含僅有單一性別參賽選手的社團，啟用此例外後，整個聯隊的實際參賽選手總數不得超過此上限。</span></div>
          </div></fieldset>
        </div>
        <p className="muted">資格條件會在聯隊成員確認與報名時由伺服器再次檢查。</p>
        <div className="button-group"><button type="button" className="secondary" onClick={() => { setEditingRule(false); void load(); }}>取消編輯</button><button disabled={busy || Boolean(activity?.registrationOpensAt && new Date(demoNow()) >= new Date(activity.registrationOpensAt))}>儲存本年度聯隊規則</button></div>
      </form>}
      </section>) : (
        <section className="card empty-note"><h2>無法載入聯隊規則</h2><p>請重新整理後再試。</p></section>
      )}
    </>;
  }
  return <>
    <Feedback busy={busy} error={error} notice={notice} />
      {clubQualification && !admin && <section className="card"><p className="eyebrow">我的社團資格</p><h2 className={!clubReadyToInitiate ? "league-qualification-failed" : undefined}>{clubReadyToInitiate ? "您的社團目前符合聯隊資格" : "您的社團目前尚未符合聯隊資格"}</h2><p>本屆有效選手：{clubQualification.participantCount} 人（男 {clubQualification.genderCounts.male}、女 {clubQualification.genderCounts.female}）</p><ul>{clubQualification.checks.map((check) => <li className={!check.passed ? "league-qualification-failed" : undefined} key={check.code}>{check.passed ? "✓" : "!"} {check.message}</li>)}{noActiveParticipants && <li className="league-qualification-failed"><strong>!</strong> 尚未建立有效選手名單，無法發起聯隊</li>}</ul>{!clubReadyToInitiate && <p className="league-qualification-failed" role="alert"><strong>未符合資格：</strong>{noActiveParticipants ? "請先建立至少 1 位有效選手" : clubQualification.blockers.map((blocker) => blocker.message).join("、")}</p>}</section>}
      {!admin && memberships.length > 0 && <section className="card">
        <p className="eyebrow">聯隊合作</p>
        <h2>聯隊合作</h2>
        {activity?.registrationClosesAt && <p className="badge">聯隊發起截止：{new Date(activity.registrationClosesAt).toLocaleString("zh-TW")}{new Date(activity.registrationClosesAt).getTime() <= demoNow() ? "（已截止）" : ""}</p>}
        {existingActiveLeague && <p className="notice" role="status">本社團已有聯隊申請；請在下方聯隊詳情編輯或撤銷。</p>}
        {noActiveParticipants && <p className="notice" role="alert">尚未建立有效選手名單，無法發起聯隊；請先到「賽事與人力」建立至少 1 位有效選手。</p>}
        {clubQualification && !clubQualification.eligible && !noActiveParticipants && <p className="notice" role="alert">目前不符合聯隊資格，無法發起聯隊；請先依上方資格提示補齊資料。</p>}
        {new Date(activity?.registrationClosesAt ?? 0).getTime() <= demoNow() && activity?.registrationClosesAt ? <p role="alert">目前已過報名截止，無法發起新的聯隊。</p> : existingActiveLeague ? <p className="muted">每個社團只能有一份聯隊申請，請使用下方既有聯隊。</p> : !clubQualification ? <p className="muted">正在檢查聯隊資格，請稍候。</p> : noActiveParticipants ? <p className="muted">建立有效選手名單後，才會開放發起聯隊。</p> : pendingInitiated ? <p className="muted">目前已有待處理邀請，完成回覆後才能再次發起。</p> : !clubReadyToInitiate ? <p className="muted">符合聯隊資格後，這裡才會開放發起。</p> : <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; setCreateRequest({ name: value(f, "name"), ownerOrganizationId: value(f, "owner") }); }}>
          <p>先建立本社團負責的聯隊，再邀請同年度的其他社團確認加入。</p>
          <div className="formgrid"><label>聯隊名稱<input name="name" required maxLength={120} /></label><label>本社團<select name="owner" required defaultValue=""><option value="" disabled>請選擇</option>{clubs.filter((c) => c.active && own.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
          <button disabled={busy}>送出發起</button>
        </form>}
      </section>}
      <section className="card"><p className="eyebrow">{admin ? "主辦監看" : "我的聯隊"}</p><h2>{admin ? "聯隊管理" : "聯隊清單"}</h2>{admin && <p>主辦單位在此查看聯隊成員、確認狀態與年度資格；聯隊由領隊發起與管理。</p>}{leagues.length === 0 ? <div className="empty-note"><p>目前尚未成立聯隊。</p><p>{admin ? "領隊可在「發起聯隊」頁邀請其他社團；受邀社團確認後，主辦可在此查看資格狀態。" : "先發起聯隊，再邀請其他社團；受邀社團確認後系統會檢查資格。"}</p></div> : <div className="league-cards">{leagues.map((l) => { const dissolved = l.status === "DISSOLVED"; const eligible = !dissolved && l.eligibility.eligible; const statusLabel = dissolved ? "已撤銷" : eligible ? "符合資格" : l.eligibility.blockers.some((blocker) => blocker.code === "CLUB_QUALIFICATION") ? "資格不符" : "待處理"; return <article className="card" key={l.id}><div className="section-heading"><h3>{l.name}</h3><span className={`badge ${eligible ? "status-confirmed" : "status-draft"}`}>{statusLabel}</span></div><p>負責社團：{l.members.find((member) => member.organizationId === l.ownerOrganizationId)?.organization.name ?? "未指定"}</p><p>成員社團：{l.eligibility.confirmedMemberCount ?? l.members.filter((m) => m.status === "CONFIRMED").length} / {l.members.length} · 有效選手：{l.eligibility.participantCount} 人</p>{!dissolved && !eligible && <p className="league-qualification-failed"><strong>未符合：</strong>{l.eligibility.blockers[0]?.message ?? "尚未符合聯隊資格"}</p>}<button className="secondary" onClick={() => setSelected(l)}>查看與處理</button></article>; })}</div>}</section>
      {selected && <section className="card league-detail-card">
        <div className="league-detail-header"><div><p className="eyebrow">聯隊詳情</p><h2>{selected.name}</h2><p className="muted">負責社團：{selectedOwnerName}</p></div><span className={"badge " + (selectedEligible ? "status-confirmed" : "status-draft")}>{selectedDissolved ? "已撤銷" : selectedEligible ? "符合資格" : selected.eligibility.blockers.some((blocker) => blocker.code === "CLUB_QUALIFICATION") ? "資格不符" : "待處理"}</span></div>
        <div className="league-detail-summary-grid">
          <div><span>負責社團</span><strong>{selectedOwnerName}</strong></div>
          <div><span>社團進度</span><strong>{selectedConfirmedCount} / {selected.members.length} 個已確認</strong></div>
          <div><span>有效選手</span><strong>{selected.eligibility.participantCount} / {selected.eligibility.maximumParticipants === null ? "不限" : selected.eligibility.maximumParticipants} 人</strong></div>
          <div><span>資格狀態</span><strong className={!selectedEligible && !selectedDissolved ? "league-qualification-failed" : undefined}>{selectedDissolved ? "已撤銷" : selectedEligible ? "符合資格" : "未符合資格"}</strong></div>
        </div>
        {!selectedDissolved && !selectedEligible && <p className="league-qualification-failed" role="alert"><strong>未符合：</strong>{selected.eligibility.blockers.map((blocker) => blocker.message).join("、") || "請依資格提示補齊資料。"}</p>}
        <div className={"league-next-step " + (selectedEligible ? "is-ready" : "")} role="status"><p>下一步</p><strong>{selectedNextStep}</strong></div>
         <div className="league-members"><h3>成員社團</h3><ul>{selected.members.map((m) => <li key={m.id}><div><strong>{m.organization.name}</strong><small>{m.status === "CONFIRMED" ? "已確認" : "等待確認"}</small></div>{m.organizationId === selected.ownerOrganizationId && <span className="badge">負責社團</span>}{!selectedDissolved && m.status === "PENDING" && own.includes(m.organizationId) && <button onClick={() => setJoinRequest(m)}>接受加入</button>}</li>)}</ul></div>
        {selectedEligible && <div className="league-available-events"><h3>可使用的賽事項目</h3><ul>{events.filter((e) => e.allowLeague && (admin || e.enabled)).map((e) => <li key={e.id}>{e.name}</li>)}</ul>{onStartRegistration && <button type="button" onClick={() => onStartRegistration(selected.id)}>{leagueRegistrationIds.has(selected.id) ? "繼續聯隊報名" : "開始聯隊報名"}</button>}</div>}
        {ownsSelected && !selectedDissolved && <div className="league-owner-actions">{leagueRegistrationIds.has(selected.id) ? <p className="muted">已建立正式報名資料，聯隊申請已鎖定，無法再編輯、撤銷或邀請社團。</p> : <div className="button-group"><button type="button" className="secondary" onClick={() => setEditRequest({ id: selected.id, name: selected.name, rowVersion: selected.rowVersion })}>編輯聯隊</button><button type="button" className="tertiary" onClick={() => void withdrawLeague(selected)}>撤銷聯隊申請</button></div>}</div>}
        {ownsSelected && !selectedDissolved && !leagueRegistrationIds.has(selected.id) && <div className="league-invite-action"><h3>邀請社團</h3><form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; void run("leagues/" + selected.id + "/members", "POST", { organizationId: value(f, "club"), rowVersion: selected.rowVersion, reason: "邀請社團加入聯隊" }); }}><label>選擇社團<select name="club" required defaultValue=""><option value="" disabled>請選擇</option>{available.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button disabled={busy}>送出邀請</button></form></div>}
        <button className="secondary" onClick={() => setSelected(null)}>關閉</button>
      </section>}
      {createRequest && <div className="modal-backdrop" role="presentation"><section className="card confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="league-create-confirm-title"><h2 id="league-create-confirm-title">確認發起聯隊？</h2><p>發起聯隊代表本次高康盃將與其他社團以聯隊方式合作參賽。建立正式報名資料前，可回到聯隊詳情編輯名稱或撤銷申請。請確認已與社團成員完成溝通。</p><div className="button-group"><button className="secondary" onClick={() => setCreateRequest(null)}>返回修改</button><button onClick={() => { const request = createRequest; setCreateRequest(null); void run(`activities/${activityId}/leagues`, "POST", { ...request, reason: "建立聯隊" }); }}>確認發起聯隊</button></div></section></div>}
      {editRequest && <div className="modal-backdrop" role="presentation"><section className="card confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="league-edit-title"><h2 id="league-edit-title">編輯聯隊</h2><p>建立正式報名資料前可以修改聯隊名稱。成員邀請狀態會保留。</p><form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const request = editRequest; setEditRequest(null); void run(`leagues/${request.id}`, "PATCH", { name: value(f, "name"), rowVersion: request.rowVersion, reason: "編輯聯隊申請" }); }}><label>聯隊名稱<input name="name" required maxLength={120} defaultValue={editRequest.name} /></label><div className="button-group"><button type="button" className="secondary" onClick={() => setEditRequest(null)}>取消</button><button disabled={busy}>儲存變更</button></div></form></section></div>}
      {joinRequest && selected && <div className="modal-backdrop" role="presentation"><section className="card confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="league-join-confirm-title"><h2 id="league-join-confirm-title">確認加入聯隊？</h2><p>接受邀請後，代表本次高康盃將與聯隊成員共同參賽。確認加入後，領隊無法自行退出本屆聯隊。</p><div className="button-group"><button className="secondary" onClick={() => setJoinRequest(null)}>取消</button><button onClick={() => { const member = joinRequest; setJoinRequest(null); void run(`leagues/${selected.id}/members/${member.id}/confirm`, "POST", { rowVersion: selected.rowVersion, reason: "接受聯隊邀請" }); }}>確認加入</button></div></section></div>}
  </>;
}
