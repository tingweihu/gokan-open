"use client";
import { demoApi } from "./demo-api";

export function api<T>(path: string, method = "GET", body?: unknown, _options?: { timeoutMs?: number }): Promise<T> {
  return demoApi<T>(path, method, body);
}

export const value = (form: HTMLFormElement, name: string) => {
  const field = new FormData(form).get(name);
  return typeof field === "string" ? field : "";
};

export function download(file: { name: string; mime: string; base64: string }) {
  const bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name.includes("DEMO") ? file.name : `DEMO-${file.name}`;
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); }, 1000);
}
