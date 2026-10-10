import { createHash, randomBytes } from "node:crypto";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;
export const MAX_EMAIL_LENGTH = 254;

export const normalizeEmail = (value: string) =>
  value.trim().normalize("NFKC").toLowerCase();

export const createOpaqueToken = () => randomBytes(32).toString("base64url");

export const hashOpaqueToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const isMutationMethod = (method: string | undefined) =>
  Boolean(method && /^(POST|PUT|PATCH|DELETE)$/i.test(method));

export function isAllowedMutationOrigin(
  origin: string | string[] | undefined,
  allowedOrigin: string,
) {
  if (!origin) return false;
  const value = Array.isArray(origin) ? origin[0] : origin;
  return value === allowedOrigin;
}
