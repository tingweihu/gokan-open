import { z } from "zod";

const nodeEnvironment = z.enum(["development", "test", "production"]);

const apiEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironment.default("development"),
  API_HOST: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65_535),
  DATABASE_URL: z.string().startsWith("postgresql://"),
  WEB_ORIGIN: z.string().url(),
});

const webEnvironmentSchema = z.object({
  NODE_ENV: nodeEnvironment.default("development"),
  API_INTERNAL_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

function formatEnvironmentError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
}

export function loadApiEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ApiEnvironment {
  const result = apiEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    throw new Error(
      `Invalid API environment: ${formatEnvironmentError(result.error)}`,
    );
  }

  return result.data;
}

export function loadWebEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): WebEnvironment {
  const result = webEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    throw new Error(
      `Invalid web environment: ${formatEnvironmentError(result.error)}`,
    );
  }

  return result.data;
}