import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const rowVersionSchema = z.coerce.number().int().min(1);

export const apiErrorSchema = z.object({
  code: z.string().min(1).max(100),
  message: z.string(),
  details: z.unknown().optional(),
});

export type ApiErrorPayload = z.infer<typeof apiErrorSchema>;
