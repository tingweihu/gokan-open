import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { fail } from "./core.js";

export const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const ALLOWED: Record<string, { mime: string; extension: string }> = {
  "application/pdf": { mime: "application/pdf", extension: ".pdf" },
  "image/jpeg": { mime: "image/jpeg", extension: ".jpg" },
  "image/png": { mime: "image/png", extension: ".png" },
};

export type ProofFile = { originalName: string; mimeType: string; bytes: Buffer };

function root() {
  const configured = process.env.GOKAN_PRIVATE_STORAGE_ROOT?.trim();
  return configured || join(tmpdir(), "gokan-private-payment-proofs");
}

function safeName(name: string, label = "付款證明") {
  const display = [...basename(name)].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? "_" : character;
  }).join("").trim();
  if (!display || display === "." || display === ".." || display.length > 180) fail("VALIDATION_FAILED", `${label}檔名不正確`, 422);
  return display;
}

function unsafeContent(bytes: Buffer) {
  const head = bytes.subarray(0, Math.min(bytes.length, 1_048_576)).toString("latin1").toLowerCase();
  return head.includes("<svg") || head.includes("<script") || head.includes("<!doctype html") || head.includes("<html") || head.includes("<?xml") || head.includes("mz\u0000") || head.startsWith("\u007felf") || head.startsWith("#!");
}

export function validateProof(input: { filename: string; mime: string; base64: string }, label = "付款證明"): ProofFile {
  const rule = ALLOWED[input.mime];
  if (!rule) fail("VALIDATION_FAILED", `僅接受 PDF、JPEG 或 PNG${label}`, 422);
  const originalName = safeName(input.filename, label);
  if (!originalName.toLowerCase().endsWith(rule.extension) && !(rule.extension === ".jpg" && originalName.toLowerCase().endsWith(".jpeg"))) fail("VALIDATION_FAILED", `${label}副檔名與 MIME 不一致`, 422);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64) || input.base64.length % 4 === 1) fail("VALIDATION_FAILED", `${label}格式不正確`, 422);
  const bytes = Buffer.from(input.base64, "base64");
  if (!bytes.length || bytes.length > MAX_PROOF_BYTES) fail("VALIDATION_FAILED", `${label}檔案過大或為空檔`, 422);
  const validMagic = rule.mime === "application/pdf" ? bytes.subarray(0, 5).toString("ascii") === "%PDF-" : rule.mime === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff : bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!validMagic || unsafeContent(bytes)) fail("VALIDATION_FAILED", `${label}內容與宣告格式不符或含有不安全內容`, 422);
  return { originalName, mimeType: rule.mime, bytes };
}

export function validateTotalRoster(input: { filename: string; mime: string; base64: string }): ProofFile {
  if (input.mime !== "application/pdf") fail("VALIDATION_FAILED", "總參賽名單（學校核章）僅接受 PDF 檔案", 422);
  const file = validateProof(input, "總參賽名單（學校核章）");
  return file;
}

export async function putProof(file: ProofFile) {
  const storageKey = `${randomUUID()}${file.mimeType === "application/pdf" ? ".pdf" : file.mimeType === "image/png" ? ".png" : ".jpg"}`;
  const directory = root();
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(join(directory, storageKey), file.bytes, { flag: "wx", mode: 0o600 });
  return { storageKey, sha256: createHash("sha256").update(file.bytes).digest("hex"), sizeBytes: file.bytes.length };
}

export async function readProof(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(storageKey)) fail("NOT_FOUND", "找不到付款證明", 404);
  try { return await fs.readFile(join(root(), storageKey)); } catch { fail("NOT_FOUND", "找不到付款證明", 404); }
}

export async function removeProof(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(storageKey)) return;
  await fs.rm(join(root(), storageKey), { force: true });
}
