"use client";
import { useCallback, useEffect, useState } from "react";
import { api, download, value } from "./client";
import { downloadDemo } from "./demo-export";
import { Feedback, useOperation } from "./shared";
import type { Club } from "./setup-screens";
type Participant = {
  id: string;
  name: string;
  gender: "MALE" | "FEMALE";
  grade: "GRADE_1" | "GRADE_2" | "GRADE_3";
  active: boolean;
  rowVersion: number;
};
type Roster = {
  club: Club;
  participants: Participant[];
  total: number;
  active: number;
  activityStage?: {
    status: string;
    stage: string;
    reason: { reasonCode: string; message: string; availableAt?: string; deadlineAt?: string } | null;
  };
};
type Upload = { name: string; mime: string; base64: string };
type Preview = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: { row: number; field: string; value: string; message: string }[];
  rows: { name: string; gender: string; grade: string }[];
};
export function RosterScreen({
  activityId,
  memberships,
  staff,
}: {
  activityId: string;
  memberships: {
    organizationId: string;
    organization: { name: string; activityId: string };
  }[];
  staff: boolean;
}) {
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const [clubId, setClubId] = useState("");
  const [roster, setRoster] = useState<Roster | null>(null);
  const [edit, setEdit] = useState<Participant | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [file, setFile] = useState<Upload | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const op = useOperation();
  const writable = memberships.some((m) => m.organizationId === clubId);
  const load = useCallback(async () => {
    if (clubId) { setRoster(await api<Roster>(`clubs/${clubId}/roster`)); return; }
    if (staff && clubs.length) {
      const rosters = await Promise.all(clubs.map((club) => api<Roster>(`clubs/${club.id}/roster`)));
      const participants = rosters.flatMap((item) => item.participants);
      const first = rosters[0]?.club;
      setRoster({ club: first ? { ...first, id: "all", code: "ALL", name: "全部社團" } : { id: "all", activityId, code: "ALL", name: "全部社團", shortName: null, active: true, rowVersion: 1 }, participants, total: rosters.reduce((sum, item) => sum + item.total, 0), active: rosters.reduce((sum, item) => sum + item.active, 0) });
    }
  }, [activityId, clubId, clubs, staff]);
  useEffect(() => {
    void op.run(async () => {
      const data = staff
        ? await api<Club[]>(`activities/${activityId}/clubs`)
        : memberships
            .filter((m) => m.organization.activityId === activityId)
            .map((m) => ({ id: m.organizationId, name: m.organization.name }));
      setClubs(data);
      setClubId(staff ? "" : data[0]?.id ?? "");
    }, "");
  }, [activityId, staff]);
  useEffect(() => {
    setRoster(null);
    setPreview(null);
    setFile(null);
    setEdit(null);
    void op.run(load, "");
  }, [load]);
  useEffect(() => { setPage(1); }, [clubId, search]);
  async function selectFile(upload: File | undefined) {
    if (!upload) return;
    await op.run(() => Promise.reject(new Error("展示站不讀取外部檔案，請按「使用示範名單」。")), "");
  }
  const rows =
    roster?.participants.filter((p) => p.name.includes(search)) ?? [];
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const activeParticipants = roster?.participants.filter((participant) => participant.active) ?? [];
  const stageReason = roster?.activityStage?.reason ?? null;
  const stageDate = (date: string | undefined) => date ? new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }).format(new Date(date)) : "";
  const stageMessage = stageReason?.reasonCode === "BEFORE_OPEN" && stageReason.availableAt
    ? `${stageReason.message}將於 ${stageDate(stageReason.availableAt)} 開放。`
    : stageReason?.reasonCode === "AFTER_DEADLINE" && stageReason.deadlineAt
      ? `${stageReason.message}截止時間為 ${stageDate(stageReason.deadlineAt)}。`
      : stageReason?.message;
  const participantSummary = {
    male: activeParticipants.filter((participant) => participant.gender === "MALE").length,
    female: activeParticipants.filter((participant) => participant.gender === "FEMALE").length,
    grade1: activeParticipants.filter((participant) => participant.grade === "GRADE_1").length,
    grade2: activeParticipants.filter((participant) => participant.grade === "GRADE_2").length,
    grade3: activeParticipants.filter((participant) => participant.grade === "GRADE_3").length,
  };
  return (
    <>
      <Feedback {...op} />
      {!clubs.length && !op.busy ? (
        <section className="card">
          <h2>尚無可存取社團</h2>
          <p>請先由主辦單位建立社團並指派領隊。</p>
        </section>
      ) : (
        <>
          <div className="formgrid">
            <label>
              選擇社團
              <select
                value={clubId}
                onChange={(e) => setClubId(e.target.value)}
              >
                {staff && <option value="">全部社團</option>}
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              搜尋姓名
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="輸入姓名"
              />
            </label>
          </div>
          <button
            className="secondary"
            onClick={() => { setPage(1); void op.run(load, "名單已重新載入"); }}
          >
            重新載入名單
          </button>
          {roster && (
            <>
              {stageMessage && <div className="stage-notice" role="status"><strong>{stageMessage}</strong>{stageReason?.reasonCode === "ORGANIZER_NOT_OPEN" && <span>請由主辦單位先將活動從「準備中」開放。</span>}</div>}
              <div className="metrics">
                <section className="card">
                  <p>選手總數</p>
                  <strong>{roster.total}</strong>
                </section>
                <section className="card">
                  <p>有效選手</p>
                  <strong>{roster.active}</strong>
                </section>
                <section className="card">
                  <p>社團</p>
                  <strong>{roster.club.name}</strong>
                </section>
                <section className="card">
                  <p>有效選手性別</p>
                  <strong>男 {participantSummary.male} ／ 女 {participantSummary.female}</strong>
                </section>
                <section className="card">
                  <p>有效選手年級</p>
                  <strong>一 {participantSummary.grade1} ／ 二 {participantSummary.grade2}</strong>
                </section>
              </div>
              {staff && <p><button className="secondary" onClick={() => downloadDemo("roster", "xlsx", clubId || undefined)}>匯出示範選手名單 XLSX</button></p>}
              {writable && !stageReason && (
                <>
                  <section className="card">
                    <h2>匯入選手名單</h2>
                    <p>
                      支援 CSV、XLSX，最多 2,000 位、4 MB。
                    </p>
                    <button
                      className="secondary"
                      disabled={op.busy}
                      onClick={() =>
                        void op.run(
                          async () =>
                            Promise.resolve(downloadDemo("template", "xlsx")),
                          "範本已下載",
                        )
                      }
                    >
                      下載 XLSX 範本
                    </button>
                    <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void selectFile(e.dataTransfer.files[0]); }}>
                      <button type="button" className="secondary" onClick={() => { setFile({ name: "DEMO-roster.csv", mime: "text/csv", base64: "" }); setPreview(null); }}>使用示範名單</button>
                      <p>展示站不讀取外部檔案。{file && "已選取：" + file.name}</p>
                    </div>
                    <button
                      disabled={op.busy || !file}
                      onClick={() =>
                        void op.run(
                          async () => {
                            const result = await api<Preview>(
                              `clubs/${clubId}/roster/import/preview`,
                              "POST",
                              { file, clubVersion: roster.club.rowVersion },
                              { timeoutMs: 60_000 },
                            );
                            if (!result || !Array.isArray(result.rows) || !Array.isArray(result.errors) || !Number.isFinite(result.totalRows)) throw new Error("名單預覽沒有回傳完整結果，請重新選擇檔案後再試。");
                            setPreview(result);
                          },
                          "預覽完成，請核對後確認匯入",
                        )
                      }
                    >
                      預覽名單
                    </button>
                    {preview && (
                      <div className="preview">
                        <h3>匯入預覽</h3>
                        <p>
                          共 {preview.totalRows} 位 · 有效 {preview.validRows}{" "}
                          位 · 錯誤 {preview.invalidRows} 位
                        </p>
                        {!!preview.errors.length && (
                          <div className="tablewrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>列號</th>
                                  <th>欄位</th>
                                  <th>原始值</th>
                                  <th>問題</th>
                                </tr>
                              </thead>
                              <tbody>
                                {preview.errors.map((e, i) => (
                                  <tr key={i}>
                                    <td>{e.row}</td>
                                    <td>{e.field}</td>
                                    <td>{e.value}</td>
                                    <td>{e.message}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        <details>
                          <summary>查看有效資料</summary>
                          <div className="tablewrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>姓名</th>
                                  <th>性別</th>
                                  <th>年級</th>
                                </tr>
                              </thead>
                              <tbody>
                                {preview.rows.map((p, i) => (
                                  <tr key={i}>
                                    <td>{p.name}</td>
                                    <td>{p.gender === "MALE" ? "男" : "女"}</td>
                                    <td>{p.grade.slice(-1)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                        <button
                          disabled={
                            op.busy ||
                            preview.invalidRows > 0 ||
                            !preview.validRows
                          }
                          onClick={() =>
                            void op.run(async () => {
                              await api(
                                `clubs/${clubId}/roster/import/commit`,
                                "POST",
                                { file, clubVersion: roster.club.rowVersion },
                                { timeoutMs: 60_000 },
                              );
                              setPreview(null);
                              setFile(null);
                              await load();
                            }, "選手名單已全部匯入")
                          }
                        >
                          確認匯入
                        </button>
                      </div>
                    )}
                  </section>
                  <section className="card collapsible-card">
                    <button type="button" className="disclosure-button" aria-expanded={manualOpen} onClick={() => setManualOpen((open) => !open)}><span>手動新增選手</span><span aria-hidden="true">{manualOpen ? "⌃" : "⌄"}</span></button>
                    {manualOpen && <form
                    key={edit?.id ?? "new"}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = e.currentTarget;
                      void op.run(async () => {
                        const data = {
                          name: value(f, "name"),
                          gender: value(f, "gender"),
                          grade: value(f, "grade"),
                        };
                        await api(
                          `clubs/${clubId}/roster` +
                            (edit ? "/" + edit.id : ""),
                          edit ? "PATCH" : "POST",
                          edit
                            ? {
                                ...data,
                                active: value(f, "active") === "true",
                                rowVersion: edit.rowVersion,
                              }
                            : data,
                        );
                        setEdit(null);
                        f.reset();
                        await load();
                      });
                    }}
                  >
                    <h2>{edit ? "編輯選手" : "新增選手"}</h2>
                    <div className="formgrid">
                      <label>
                        選手姓名
                        <input
                          name="name"
                          required
                          maxLength={120}
                          defaultValue={edit?.name}
                        />
                      </label>
                      <label>
                        性別
                        <select
                          name="gender"
                          defaultValue={edit?.gender ?? "MALE"}
                        >
                          <option value="MALE">男</option>
                          <option value="FEMALE">女</option>
                        </select>
                      </label>
                      <label>
                        年級
                        <select
                          name="grade"
                          defaultValue={edit?.grade ?? "GRADE_1"}
                        >
                          <option value="GRADE_1">一年級</option>
                          <option value="GRADE_2">二年級</option>
                          <option value="GRADE_3">三年級</option>
                        </select>
                      </label>
                      {edit && (
                        <label>
                          選手狀態
                          <select
                            name="active"
                            defaultValue={String(edit.active)}
                          >
                            <option value="true">有效</option>
                            <option value="false">停用</option>
                          </select>
                        </label>
                      )}
                    </div>
                    <button disabled={op.busy}>
                      {edit ? "儲存選手" : "新增選手"}
                    </button>
                    {edit && (
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => setEdit(null)}
                      >
                        取消編輯
                      </button>
                    )}
                  </form>}
                  </section>
                </>
              )}
              <section className="card collapsible-card">
                <button type="button" className="disclosure-button" aria-expanded={listOpen} onClick={() => setListOpen((open) => !open)}><span>選手名單 · {rows.length}</span><span aria-hidden="true">{listOpen ? "⌃" : "⌄"}</span></button>
                {listOpen && <div>
                {!rows.length ? (
                  <p>
                    尚無符合的選手。{writable && "您可以匯入名單或手動新增。"}
                  </p>
                ) : (
                  <>
                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr>
                          <th>姓名</th>
                          <th>性別</th>
                          <th>年級</th>
                          <th>狀態</th>
                          {writable && <th>操作</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((p) => (
                          <tr key={p.id}>
                            <td>{p.name}</td>
                            <td>{p.gender === "MALE" ? "男" : "女"}</td>
                            <td>{p.grade.slice(-1)} 年級</td>
                            <td>{p.active ? "有效" : "停用"}</td>
                            {writable && (
                              <td>
                                <button
                                  className="secondary"
                                  onClick={() => { setEdit(p); setManualOpen(true); }}
                                >
                                  編輯 {p.name}
                                </button>
                                {p.active && (
                                  <button
                                    type="button"
                                    className="secondary"
                                    disabled={op.busy}
                                    onClick={() => void op.run(async () => {
                                      await api(`clubs/${clubId}/roster/${p.id}`, "PATCH", { active: false, rowVersion: p.rowVersion });
                                      setEdit(null);
                                      await load();
                                    }, "選手已停用")}
                                  >
                                    停用
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pagination" aria-label="選手名單分頁"><span>共 {rows.length} 位</span><button type="button" className="secondary" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一頁</button><span>第 {currentPage} / {pageCount} 頁</span><button type="button" className="secondary" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一頁</button></div>
                  </>
                )}
                </div>}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
