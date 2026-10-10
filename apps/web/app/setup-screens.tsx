"use client";
import { useCallback, useEffect, useState } from "react";
import { api, value } from "./client";
import { Feedback, useOperation } from "./shared";
export type Club = {
  id: string;
  activityId: string;
  code: string;
  name: string;
  shortName: string | null;
  active: boolean;
  rowVersion: number;
};
type Activity = {
  id: string;
  name: string;
  year: number;
  status: string;
  rowVersion: number;
  stage: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  paymentDueAt: string | null;
  leaderMeetingStartsAt: string | null;
  leaderMeetingEndsAt: string | null;
  competitionStartsAt: string | null;
  competitionEndsAt: string | null;
};
export const dateFields = [
  ["registrationOpensAt", "報名開始"],
  ["registrationClosesAt", "報名截止"],
  ["paymentDueAt", "繳費截止"],
  ["leaderMeetingStartsAt", "領隊會議開始"],
  ["leaderMeetingEndsAt", "領隊會議結束"],
  ["competitionStartsAt", "比賽開始"],
  ["competitionEndsAt", "比賽結束"],
] as const;
function localDate(value: string | number | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 16);
}
function summaryDate(value: string | number | null | undefined) {
  if (!value) return "未設定";
  return new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }).format(new Date(value));
}
function dateSummaryRange(start: string | null | undefined, end: string | null | undefined) {
  return <><strong>{summaryDate(start)}</strong><span className="summary-arrow" aria-hidden="true">→</span><strong>{summaryDate(end)}</strong></>;
}
const dateValidationRules: Array<[string, string, string, string, "before" | "after"]> = [
  ["registrationClosesAt", "報名截止", "registrationOpensAt", "報名截止必須晚於報名開始。", "after"],
  ["leaderMeetingStartsAt", "領隊會議開始", "registrationClosesAt", "領隊會議開始不得早於報名截止。", "after"],
  ["leaderMeetingEndsAt", "領隊會議結束", "leaderMeetingStartsAt", "結束時間必須晚於開始時間。", "after"],
  ["competitionStartsAt", "比賽開始", "leaderMeetingEndsAt", "比賽開始不得早於領隊會議結束。", "after"],
  ["competitionEndsAt", "比賽結束", "competitionStartsAt", "比賽結束必須晚於比賽開始。", "after"],
  ["paymentDueAt", "繳費截止", "registrationOpensAt", "繳費截止不得早於報名開始。", "after"],
  ["paymentDueAt", "繳費截止", "registrationClosesAt", "繳費截止不得早於報名截止。", "after"],
  ["paymentDueAt", "繳費截止", "competitionEndsAt", "繳費截止不得晚於比賽結束。", "before"],
];
function validateActivityDates(form: Record<string, string>) {
  const errors: Record<string, string> = {};
  for (const [field, label, previous, rule, relation] of dateValidationRules) {
    const current = new Date(form[field] ?? "").getTime();
    const compare = new Date(form[previous] ?? "").getTime();
    const invalid = relation === "after" ? current <= compare : current > compare;
    if (form[field] && form[previous] && invalid) {
      errors[field] = `請調整「${label}」：${rule}`;
    }
  }
  return errors;
}
function nextCalendarDay(value: string) {
  if (!value) return "";
  const [date] = value.split("T");
  if (!date) return "";
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T18:00`;
}
function activityForm(activity: Activity) {
  return {
    name: activity.name,
    status: activity.status,
    reason: "",
    ...Object.fromEntries(dateFields.map(([key]) => [key, localDate(activity[key])])),
  } as Record<string, string>;
}
function resetActivityState(activity: Activity) {
  const nextForm = activityForm(activity);
  const derived = nextCalendarDay(nextForm.competitionStartsAt ?? "");
  return { form: nextForm, autoCompetitionEnd: nextForm.competitionEndsAt === derived ? nextForm.competitionEndsAt : "" };
}
export function AnnualSettings({
  activityId,
}: {
  activityId: string;
}) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [autoCompetitionEnd, setAutoCompetitionEnd] = useState("");
  const [dateErrors, setDateErrors] = useState<Record<string, string>>({});
  const op = useOperation();
  const load = useCallback(async () => {
    const current = await api<Activity>(`activities/${activityId}`);
    setActivity(current);
    const reset = resetActivityState(current);
    setForm(reset.form);
    setAutoCompetitionEnd(reset.autoCompetitionEnd);
    setEditing(!dateFields.every(([key]) => Boolean(reset.form[key])));
  }, [activityId]);
  useEffect(() => {
    void op.run(load, "");
  }, [load]);
  async function openActivity() {
    if (!activity) return;
    const dates = Object.fromEntries(dateFields.map(([key]) => [key, activity[key]]));
    const updated = await api<Activity>(`activities/${activityId}`, "PATCH", {
      rowVersion: activity.rowVersion,
      name: activity.name,
      status: "ACTIVE",
      reason: "開放本年度活動",
      ...dates,
    });
    const reset = resetActivityState(updated);
    setActivity(updated);
    setForm(reset.form);
    setAutoCompetitionEnd(reset.autoCompetitionEnd);
    setEditing(false);
  }
  return (
    <>
      <Feedback {...op} />
      <button
        className="secondary"
        onClick={() => void op.run(load, "已重新載入")}
      >
        重新載入設定
      </button>
      {activity ? (
        <section className="card annual-settings-card">
          <h2>{activity.year} 年度設定</h2>
          <p>所有時間均為臺北時間（UTC+8）。請先設定日期，再開放活動。</p>
            {!editing && dateFields.every(([key]) => Boolean(form[key])) ? <>
            <div className="annual-summary-head"><div><p className="eyebrow">{activity.year} 年度設定</p><h3>{form.name}</h3></div><span className="badge status-confirmed">{form.status === "DRAFT" ? "準備中" : form.status === "ACTIVE" ? "開放運作" : "封存"}</span></div>
            <div className="annual-summary-grid"><section><h3>報名期間</h3><div className="summary-range">{dateSummaryRange(form.registrationOpensAt, form.registrationClosesAt)}</div></section><section><h3>繳費截止</h3><strong>{summaryDate(form.paymentDueAt)}</strong></section><section><h3>領隊會議</h3><div className="summary-range">{dateSummaryRange(form.leaderMeetingStartsAt, form.leaderMeetingEndsAt)}</div></section><section><h3>比賽日期</h3><div className="summary-range">{dateSummaryRange(form.competitionStartsAt, form.competitionEndsAt)}</div></section></div><p className="muted timezone-note">時間顯示以台北時間（Asia/Taipei）為準。</p>
            {activity.status === "DRAFT" ? <div className="annual-lifecycle-actions"><div className="stage-notice"><strong>目前狀態：準備中</strong><span>即使目前時間已進入設定的報名期間，領隊仍會看到「主辦單位尚未開放」；請確認年度設定後手動開放本年度活動。</span></div><div className="button-group">{activity.registrationOpensAt && new Date() >= new Date(activity.registrationOpensAt) ? <span className="lock-banner">報名已開始，年度日期設定已鎖定。</span> : <button type="button" className="secondary" onClick={() => setEditing(true)}>編輯年度設定</button>}<button type="button" onClick={() => void op.run(openActivity, "本年度活動已開放")}>開放本年度活動</button></div></div> : activity.registrationOpensAt && new Date() >= new Date(activity.registrationOpensAt) ? <><p className="lock-banner">報名已開始，年度日期設定已鎖定。</p>{activity.status === "ACTIVE" && activity.stage === "CLOSEOUT" && <form className="archive-activity-form" onSubmit={(e) => { e.preventDefault(); const reason = value(e.currentTarget, "archiveReason"); void op.run(async () => { const dates = Object.fromEntries(dateFields.map(([key]) => [key, activity[key]])); const updated = await api<Activity>(`activities/${activityId}`, "PATCH", { rowVersion: activity.rowVersion, name: activity.name, status: "ARCHIVED", reason, ...dates }); const reset = resetActivityState(updated); setActivity(updated); setForm(reset.form); setAutoCompetitionEnd(reset.autoCompetitionEnd); }); }}><label>封存原因<textarea name="archiveReason" required maxLength={1000} placeholder="請填寫本年度活動已完成的原因" /></label><button disabled={op.busy}>封存本年度活動</button></form>}</> : <button className="secondary" onClick={() => setEditing(true)}>編輯年度設定</button>}
            </> : <form onSubmit={(e) => { e.preventDefault(); if (!activity) return; const errors = validateActivityDates(form); setDateErrors(errors); if (Object.keys(errors).length) { void op.run(() => Promise.reject(new Error(`請先修正日期欄位：${Object.values(errors).join(" ")}`)), ""); return; } void op.run(async () => { const dates = Object.fromEntries(dateFields.map(([key]) => [key, new Date(form[key] + ":00+08:00").toISOString()])); const updated = await api<Activity>(`activities/${activityId}`, "PATCH", { rowVersion: activity.rowVersion, name: form.name, status: form.status, reason: form.reason, ...dates }); const reset = resetActivityState(updated); setActivity(updated); setForm(reset.form); setDateErrors({}); setEditing(false); setAutoCompetitionEnd(reset.autoCompetitionEnd); }); }}>
            <div className="formgrid"><label>活動名稱<input name="name" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} /></label><label>活動狀態<select name="status" value={form.status ?? "DRAFT"} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="DRAFT">準備中</option><option value="ACTIVE">開放運作</option><option value="ARCHIVED">封存</option></select></label></div>
            <div className="muted activity-status-help" aria-label="活動狀態說明"><span>準備中：供主辦建置年度資料，尚未進入正式運作。</span><span>開放運作：啟用本年度工作區，各功能仍依設定日期開放。</span><span>封存：年度活動結束後保留資料，停止日常操作。</span></div>
            {activity.registrationOpensAt && new Date() >= new Date(activity.registrationOpensAt) && <p className="lock-banner">報名已開始，年度日期設定已鎖定。</p>}
            <div className="settings-date-groups">
              {[["報名期間", [["registrationOpensAt", "報名開始"], ["registrationClosesAt", "報名截止"]]], ["繳費截止", [["paymentDueAt", "繳費截止"]]], ["領隊會議", [["leaderMeetingStartsAt", "領隊會議開始"], ["leaderMeetingEndsAt", "領隊會議結束"]]], ["正式比賽", [["competitionStartsAt", "比賽開始"], ["competitionEndsAt", "比賽結束"]]]] .map(([group, fields]) => <fieldset className="settings-date-group" key={group as string}><legend>{group as string}</legend><div className="settings-date-row">{(fields as [string, string][]).map(([key, title]) => <label key={key}>{title}<input name={key} type="datetime-local" required aria-invalid={Boolean(dateErrors[key])} aria-describedby={dateErrors[key] ? `${key}-error` : undefined} value={form[key] ?? ""} onChange={(e) => { const next = e.target.value; setDateErrors((current) => { const updated = { ...current }; delete updated[key]; return updated; }); if (key === "competitionStartsAt") { const derived = nextCalendarDay(next); setForm((current) => ({ ...current, competitionStartsAt: next, ...( !current.competitionEndsAt || (autoCompetitionEnd && current.competitionEndsAt === autoCompetitionEnd) ? { competitionEndsAt: derived } : {}) })); setAutoCompetitionEnd(derived); } else { setForm((current) => ({ ...current, [key]: next })); if (key === "competitionEndsAt" && next !== autoCompetitionEnd) setAutoCompetitionEnd(""); } }} />{dateErrors[key] && <span id={`${key}-error`} className="field-error" role="alert">{dateErrors[key]}</span>}</label>)}</div></fieldset>)}
            </div>
            {form.competitionStartsAt && form.competitionEndsAt && new Date(form.competitionEndsAt.slice(0, 10) + "T00:00:00Z").getTime() !== new Date(nextCalendarDay(form.competitionStartsAt).slice(0, 10) + "T00:00:00Z").getTime() && <p className="muted date-warning">高康盃目前以兩天賽程呈現，建議比賽結束日期設為比賽開始日期的次日。</p>}
            <label>變更原因<textarea name="reason" value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} required maxLength={1000} /></label>
            <div className="button-group"><button type="button" className="secondary" onClick={() => { const reset = resetActivityState(activity); setForm(reset.form); setAutoCompetitionEnd(reset.autoCompetitionEnd); setEditing(false); }}>取消編輯</button><button disabled={op.busy}>儲存年度設定</button></div>
          </form>}
        </section>
      ) : (
        !op.busy && <div className="card">尚未載入年度設定</div>
      )}
    </>
  );
}
type ClubAccount = {
  id: string;
  displayName: string;
  organizationMemberships: {
    organizationId: string;
    role: "LEADER" | "DEPUTY";
    revokedAt: string | null;
  }[];
};
export function ClubManagement({ activityId }: { activityId: string }) {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [users, setUsers] = useState<ClubAccount[]>([]);
  const [edit, setEdit] = useState<Club | null>(null);
  const [selected, setSelected] = useState("");
  const op = useOperation();
  const load = useCallback(async () => {
    const [c, u] = await Promise.all([
      api<Club[]>(`activities/${activityId}/clubs`),
      api<ClubAccount[]>(`activities/${activityId}/accounts`),
    ]);
    setClubs(c);
    setUsers(u);
    setSelected((s) => s || c[0]?.id || "");
  }, [activityId]);
  useEffect(() => {
    void op.run(load, "");
  }, [load]);
  return (
    <>
      <Feedback {...op} />
      <button
        className="secondary"
        onClick={() => void op.run(load, "已重新載入")}
      >
        重新載入社團
      </button>
      <form
        className="card"
        key={edit?.id ?? "create"}
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          void op.run(async () => {
            const data = {
              code: value(f, "code"),
              name: value(f, "name"),
              shortName: value(f, "shortName") || null,
              active: value(f, "active") === "true",
            };
            await api(
              `activities/${activityId}/clubs` + (edit ? "/" + edit.id : ""),
              edit ? "PATCH" : "POST",
              edit
                ? {
                    ...data,
                    rowVersion: edit.rowVersion,
                    reason: value(f, "reason"),
                  }
                : data,
            );
            setEdit(null);
            f.reset();
            await load();
          });
        }}
      >
        <h2>{edit ? "編輯社團" : "建立社團"}</h2>
        <div className="formgrid">
          <label>
            社團代碼
            <input
              name="code"
              required
              maxLength={30}
              defaultValue={edit?.code}
            />
          </label>
          <label>
            社團名稱
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={edit?.name}
            />
          </label>
          <label>
            社團簡稱
            <input
              name="shortName"
              maxLength={30}
              defaultValue={edit?.shortName ?? ""}
            />
          </label>
          <label>
            社團狀態
            <select name="active" defaultValue={String(edit?.active ?? true)}>
              <option value="true">啟用</option>
              <option value="false">停用</option>
            </select>
          </label>
        </div>
        {edit && (
          <label>
            變更原因
            <input name="reason" required maxLength={1000} />
          </label>
        )}
        <button disabled={op.busy}>{edit ? "儲存社團" : "建立社團"}</button>
        {edit && (
          <button
            type="button"
            className="secondary"
            onClick={() => setEdit(null)}
          >
            取消編輯
          </button>
        )}
      </form>
      <section className="card">
        <h2>社團清單 · {clubs.length}</h2>
        {!clubs.length ? (
          <p>尚無社團，請先建立社團。</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>代碼</th>
                  <th>名稱</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {clubs.map((c) => (
                  <tr key={c.id}>
                    <td>{c.code}</td>
                    <td>{c.name}</td>
                    <td>{c.active ? "啟用" : "停用"}</td>
                    <td>
                      <button className="secondary" onClick={() => setEdit(c)}>
                        編輯 {c.name}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {!!clubs.length && (
        <>
          <section className="card">
            <h2>領隊與副領隊</h2>
            <label>
              管理社團
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                void op.run(async () => {
                  await api(`activities/${activityId}/accounts`, "POST", {
                    email: value(f, "email"),
                    displayName: value(f, "displayName"),
                    temporaryPassword: value(f, "temporaryPassword"),
                    assignment: {
                      kind: "club",
                      organizationId: selected,
                      role: value(f, "role"),
                    },
                  });
                  f.reset();
                  await load();
                });
              }}
            >
              <div className="formgrid">
                <label>
                  領隊姓名
                  <input name="displayName" required maxLength={120} />
                </label>
                <label>
                  領隊電子郵件
                  <input name="email" type="email" required />
                </label>
                <label>
                  社團角色
                  <select name="role">
                    <option value="LEADER">領隊</option>
                    <option value="DEPUTY">副領隊</option>
                  </select>
                </label>
                <label>
                  領隊臨時密碼
                  <input
                    name="temporaryPassword"
                    type="password"
                    required
                    minLength={12}
                    maxLength={256}
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <button disabled={op.busy}>建立社團帳號</button>
            </form>
          </section>
          <section className="card">
            <h2>目前社團成員</h2>
            {users
              .filter((u) =>
                u.organizationMemberships.some(
                  (m) => m.organizationId === selected,
                ),
              )
              .map((u) => {
                const m = u.organizationMemberships.find(
                  (m) => m.organizationId === selected,
                )!;
                return (
                  <form
                    key={u.id}
                    className="member-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = e.currentTarget;
                      void op.run(async () => {
                        await api(
                          `activities/${activityId}/accounts/${u.id}/assignment`,
                          "POST",
                          {
                            assignment: {
                              kind: "club",
                              organizationId: selected,
                              role: m.role,
                            },
                            revoked: !m.revokedAt,
                            reason: value(f, "reason"),
                          },
                        );
                        await load();
                      });
                    }}
                  >
                    <h3>
                      {u.displayName} ·{" "}
                      {m.role === "LEADER" ? "領隊" : "副領隊"} ·{" "}
                      {m.revokedAt ? "已撤銷" : "有效"}
                    </h3>
                    <label>
                      權限變更原因
                      <input name="reason" required maxLength={1000} />
                    </label>
                    <button disabled={op.busy}>
                      {m.revokedAt ? "恢復權限" : "撤銷權限"}
                    </button>
                  </form>
                );
              })}
          </section>
        </>
      )}
    </>
  );
}
