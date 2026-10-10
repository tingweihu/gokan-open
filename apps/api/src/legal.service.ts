import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { Database, fail, lock, parse, uuid, type RequestContext } from "./core.js";
import { IdentityService } from "./identity.service.js";

const typeSchema = z.enum(["PRIVACY", "TERMS"]);
const inputSchema = z.object({
  documentType: typeSchema,
  title: z.string().trim().min(1).max(160),
  version: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/),
  bodyMarkdown: z.string().trim().min(1).max(20000).refine((value) => !/[<>]|javascript\s*:|data\s*:/i.test(value), "內容不可包含 HTML 或可執行連結"),
}).strict();
const prefix = (type: "PRIVACY" | "TERMS") => `${type}::`;
function typeOf(version: string): "PRIVACY" | "TERMS" { return version.startsWith("TERMS::") ? "TERMS" : "PRIVACY"; }
function view(document: { id: string; version: string; title: string; bodyMarkdown: string; required: boolean; publishedAt: Date; createdAt: Date }) {
  return { id: document.id, documentType: typeOf(document.version), version: document.version.replace(/^[A-Z]+::/, ""), title: document.title, bodyMarkdown: document.bodyMarkdown, required: document.required, publishedAt: document.publishedAt.toISOString(), status: document.publishedAt <= new Date() ? "PUBLISHED" : "DRAFT", createdAt: document.createdAt.toISOString() };
}

@Injectable()
export class LegalService {
  constructor(private readonly db: Database, private readonly identity: IdentityService) {}
  private async admin(request: RequestContext, activityId: string) {
    parse(uuid, activityId);
    const actor = await this.identity.authenticate(request);
    await this.identity.staff(this.db, actor.user.id, activityId, ["SYSTEM_ADMIN"]);
    return actor.user.id;
  }
  async publicDocument(type: string) {
    const parsed = parse(typeSchema, type.toUpperCase());
    const doc = await this.db.policyDocument.findFirst({ where: { OR: [{ version: { startsWith: prefix(parsed) } }, ...(parsed === "PRIVACY" ? [{ version: "v1" }] : [])], publishedAt: { lte: new Date() } }, orderBy: [{ publishedAt: "desc" }, { version: "desc" }] });
    if (!doc) fail("NOT_FOUND", "目前尚未發布此文件", 404);
    return view(doc);
  }
  async list(request: RequestContext, activityId: string) {
    await this.admin(request, activityId);
    const docs = await this.db.policyDocument.findMany({ orderBy: [{ createdAt: "desc" }, { version: "desc" }] });
    return docs.map(view);
  }
  async create(request: RequestContext, activityId: string, input: unknown) {
    const actor = await this.admin(request, activityId);
    const data = parse(inputSchema, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, "legal:documents");
      const doc = await tx.policyDocument.create({ data: { version: `${prefix(data.documentType)}${data.version}`, title: data.title, bodyMarkdown: data.bodyMarkdown, required: data.documentType === "PRIVACY", publishedAt: new Date("9999-12-31T00:00:00.000Z") } });
      
      return view(doc);
    });
  }
  async update(request: RequestContext, activityId: string, id: string, input: unknown) {
    const actor = await this.admin(request, activityId); parse(uuid, id); const data = parse(inputSchema, input);
    return this.db.$transaction(async (tx) => {
      await lock(tx, "legal:documents");
      const existing = await tx.policyDocument.findUnique({ where: { id } });
      if (!existing) fail("NOT_FOUND", "找不到法務文件", 404);
      if (existing.publishedAt <= new Date()) fail("PUBLISHED_LOCKED", "已發布版本不可修改，請建立新版本");
      const doc = await tx.policyDocument.update({ where: { id }, data: { version: `${prefix(data.documentType)}${data.version}`, title: data.title, bodyMarkdown: data.bodyMarkdown, required: data.documentType === "PRIVACY" } });
      
      return view(doc);
    });
  }
  async publish(request: RequestContext, activityId: string, id: string) {
    const actor = await this.admin(request, activityId); parse(uuid, id);
    return this.db.$transaction(async (tx) => {
      await lock(tx, "legal:documents");
      const existing = await tx.policyDocument.findUnique({ where: { id } });
      if (!existing) fail("NOT_FOUND", "找不到法務文件", 404);
      if (existing.publishedAt <= new Date()) fail("PUBLISHED_LOCKED", "此版本已發布");
      const doc = await tx.policyDocument.update({ where: { id }, data: { publishedAt: new Date() } });
      
      return view(doc);
    });
  }
}
