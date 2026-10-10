"use client";
import { useEffect, useState } from "react";
export function useOperation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function run(action: () => Promise<unknown>, success = "資料已更新") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失敗");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, run };
}
export function Feedback({
  busy,
  error,
  notice,
}: {
  busy: boolean;
  error: string;
  notice: string;
}) {
  const [dismissedError, setDismissedError] = useState("");
  const [dismissedNotice, setDismissedNotice] = useState("");
  useEffect(() => {
    setDismissedError("");
  }, [error]);
  useEffect(() => {
    setDismissedNotice("");
    if (!notice) return;
    const timer = window.setTimeout(() => setDismissedNotice(notice), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const visibleError = error && error !== dismissedError ? error : "";
  const visibleNotice = notice && notice !== dismissedNotice ? notice : "";
  return (
    <>
      {busy && <p role="status">處理中…</p>}
      {visibleError && (
        <div role="alert" className="alert error">
          <span>{visibleError}</span>
          <button type="button" className="alert-dismiss" aria-label="關閉錯誤訊息" onClick={() => setDismissedError(error)}>關閉</button>
        </div>
      )}
      {visibleNotice && (
        <div role="status" className="alert success">
          <span>{visibleNotice}</span>
          <button type="button" className="alert-dismiss" aria-label="關閉成功訊息" onClick={() => setDismissedNotice(notice)}>關閉</button>
        </div>
      )}
    </>
  );
}
