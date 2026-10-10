import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { loadApiEnvironment } from "@gokan/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ApiErrors } from "./core.js";
import { AppModule } from "./app.module.js";
import { isAllowedMutationOrigin, isMutationMethod } from "./security.js";

async function bootstrap(): Promise<void> {
  const environment = loadApiEnvironment();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(
    (
      request: IncomingMessage,
      response: {
        setHeader(name: string, value: string): void;
        status(code: number): { json(value: unknown): void };
      },
      next: () => void,
    ) => {
      const requestId = randomUUID();
      request.headers["x-request-id"] = requestId;
      response.setHeader("X-Request-Id", requestId);
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Frame-Options", "DENY");
      response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      response.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
      );
      response.setHeader(
        "Content-Security-Policy",
        "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      );

      if (
        isMutationMethod(request.method) &&
        !isAllowedMutationOrigin(request.headers.origin, environment.WEB_ORIGIN)
      ) {
        response.status(403).json({
          code: "ORIGIN_NOT_ALLOWED",
          message: "Request origin is not allowed",
          details: {},
        });
        return;
      }

      next();
    },
  );

  app.enableCors({
    origin: environment.WEB_ORIGIN,
    credentials: true,
  });
  // Base64 file uploads carry a JSON envelope. Parse only these upload
  // routes with their bounded 15 MB envelope limit; all other JSON routes
  // keep the tighter global parser limit below.
  app.use((
    request: IncomingMessage & { body?: unknown },
    response: { status(code: number): { json(value: unknown): void } },
    next: () => void,
  ) => {
    if (request.method !== "POST" || !/(?:\/registrations\/[^/]+\/(?:payment-proof|total-roster)|\/activities\/[^/]+\/accounts\/bulk-preview-file)(?:\?|$)/.test(request.url ?? "")) {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;
    request.on("data", (chunk: Buffer | string) => {
      if (rejected) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > 15 * 1024 * 1024) {
        rejected = true;
        response.status(413).json({ code: "PAYLOAD_TOO_LARGE", message: "Payload too large", details: {} });
        request.removeAllListeners("data");
        request.removeAllListeners("end");
        request.resume();
        return;
      }
      chunks.push(bytes);
    });
    request.on("end", () => {
      if (rejected) return;
      try {
        request.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        next();
      } catch {
        response.status(400).json({ code: "INVALID_JSON", message: "Invalid JSON", details: {} });
      }
    });
    request.on("error", () => {
      if (!rejected) response.status(400).json({ code: "INVALID_JSON", message: "Invalid request body", details: {} });
    });
  });
  app.useBodyParser("json", { limit: "6mb" });
  app.useGlobalFilters(new ApiErrors());
  app.enableShutdownHooks();

  await app.listen(environment.API_PORT, environment.API_HOST);
}

void bootstrap();
