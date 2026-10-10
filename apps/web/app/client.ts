export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  options?: { timeoutMs?: number },
): Promise<T> {
  const controller = options?.timeoutMs ? new AbortController() : undefined;
  const timeout = options?.timeoutMs ? window.setTimeout(() => controller?.abort(), options.timeoutMs) : undefined;
  let response: Response;
  try {
    response = await fetch("/api/" + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("要求逾時，請重新操作或稍後再試。");
    throw error;
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
  const raw = await response.text();
  let data = {} as {
    code?: string;
    message?: string;
    details?: { fields?: { path?: string; message?: string }[] };
  } & T;
  if (raw.trim()) {
    try {
      data = JSON.parse(raw) as {
        code?: string;
        message?: string;
      } & T;
    } catch {
      throw new Error(response.ok ? "伺服器回應格式錯誤" : "無法完成要求");
    }
  }
  if (!response.ok) {
    const fieldMessages = data.code === "VALIDATION_FAILED" && Array.isArray(data.details?.fields)
      ? data.details.fields.map((field) => field.message).filter((message): message is string => Boolean(message))
      : [];
    throw new Error(
      data.code === "STALE_VERSION"
        ? "資料已被其他人更新，請重新整理後再試。您輸入的內容仍保留。"
        : fieldMessages.length ? fieldMessages.join(" ") : (data.message ?? "無法完成要求"),
    );
  }
  return data;
}
export const value = (form: HTMLFormElement, name: string) => {
  const field = new FormData(form).get(name);
  return typeof field === "string" ? field : "";
};
export function download(file: { name: string; mime: string; base64: string }) {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 1000);
}
