import { Catch, HttpException, Injectable } from "@nestjs/common";
import type {
  ArgumentsHost,
  ExceptionFilter,
  OnModuleDestroy,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
export type Tx = Prisma.TransactionClient;
export const uuid = z.string().uuid();
export const version = z.number().int().positive();
export const label = z.string().trim().min(1).max(120);
export const reason = z.string().trim().min(1).max(1000);
export function fail(
  code: string,
  message: string,
  status = 409,
  details: unknown = {},
): never {
  throw new HttpException({ code, message, details }, status);
}
export function parse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success)
    fail("VALIDATION_FAILED", "請檢查輸入資料", 422, {
      fields: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  return result.data;
}
@Injectable()
export class Database extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
export interface RequestContext {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
  method?: string;
  url?: string;
  path?: string;
}
export interface HttpResponse {
  setHeader(name: string, value: string): void;
  status(code: number): HttpResponse;
  json(value: unknown): void;
}
@Catch()
export class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    if (error instanceof HttpException) {
      const body = error.getResponse();
      response.status(error.getStatus()).json(
        typeof body === "object" && "code" in body
          ? body
          : {
              code: error.getStatus() === 404 ? "NOT_FOUND" : "REQUEST_FAILED",
              message: "無法完成要求",
              details: {},
            },
      );
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const request = host.switchToHttp().getRequest<RequestContext>();
      const code =
        error.code === "P2025"
          ? "STALE_VERSION"
          : error.code === "P2002"
            ? "DUPLICATE_RECORD"
            : error.code === "P2034"
              ? "STALE_VERSION"
              : "DATA_INTEGRITY_CONFLICT";
      const requestId = request.headers["x-request-id"];
      const safeMeta = this.safePrismaMeta(error.meta);
      console.error("[api] Prisma known request error", {
        requestId: Array.isArray(requestId) ? requestId[0] : requestId,
        method: request.method,
        path: request.path ?? request.url?.split("?")[0],
        prismaCode: error.code,
        meta: safeMeta,
      });
      response.status(409).json({
        code,
        message:
          code === "STALE_VERSION"
            ? "資料已被其他人更新，請重新整理後再試。"
            : code === "DUPLICATE_RECORD"
              ? "資料已存在，請檢查是否有重複的社團代碼或 Email"
              : "資料狀態發生衝突，請重新整理後再試",
        details: {},
      });
      return;
    }
    response.status(500).json({
      code: "INTERNAL_ERROR",
      message: "服務暫時無法處理，請稍後再試",
      details: {},
    });
  }
  private safePrismaMeta(meta: unknown) {
    if (!meta || typeof meta !== "object") return {};
    const source = meta as Record<string, unknown>;
    const safe: Record<string, string | string[]> = {};
    for (const key of ["target", "constraint", "field_name", "model_name", "column_name", "table"]) {
      const value = source[key];
      if (typeof value === "string") safe[key] = value;
      else if (Array.isArray(value) && value.every((item) => typeof item === "string")) safe[key] = value;
    }
    return safe;
  }
}

export async function lock(tx: Tx, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}
