import { Body, Controller, Get, Param, Patch, Post, Req, Res } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";
import {
  Database,
  fail,
  lock,
  parse,
  uuid,
  label,
  reason,
  type RequestContext,
  type Tx,
} from "./core.js";
import { inspectXlsxArchive, loadSpreadsheetWorkbook, safeCell } from "./spreadsheet.js";
import {
  IdentityService,
  email,
  password,
  passwordHash,
  publicUser,
} from "./identity.service.js";
const assignment = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("staff"),
      role: z.enum(["SYSTEM_ADMIN", "REGISTRATION_FINANCE", "CHECKIN_EXPORT"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("club"),
      organizationId: uuid,
      role: z.enum(["LEADER", "DEPUTY"]),
    })
    .strict(),
]);
const bulkRow = z.object({ clubCode: z.string().trim().min(1).max(30), clubName: label, clubShortName: z.string().trim().max(60).nullable().optional(), leaderName: label, leaderEmail: email, deputyName: label.nullable().optional(), deputyEmail: email.nullable().optional() }).strict();
const bulkInput = z.object({ rows: z.array(z.unknown()).max(100), fingerprint: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
const bulkColumns = ["社團代碼", "社團名稱", "社團簡稱", "領隊姓名", "領隊帳號", "副領隊姓名", "副領隊帳號"] as const;
type BulkRow = z.infer<typeof bulkRow>;
const normalizeBulkEmail = (value: string) => value.trim().normalize("NFKC").toLowerCase();
export function normalizeBulkRow(item: BulkRow) {
  return {
    ...item,
    clubCode: item.clubCode.trim().normalize("NFKC").toUpperCase(),
    leaderEmail: normalizeBulkEmail(item.leaderEmail),
    deputyEmail: item.deputyEmail ? normalizeBulkEmail(item.deputyEmail) : null,
  };
}
type BulkAccountRole = "LEADER" | "DEPUTY";
type PreparedBulkAccount = Readonly<{
  name: string;
  email: string;
  role: BulkAccountRole;
  passwordHash: string;
}>;
type PreparedBulkRow = Readonly<{
  row: Readonly<BulkRow>;
  accounts: readonly PreparedBulkAccount[];
}>;
export type BulkCredentialMaterial = {
  rows: readonly PreparedBulkRow[];
  count: number;
  deputyCount: number;
  file: {
    name: string;
    mime: string;
    base64: string;
  };
};
export type BulkPreparationDependencies = {
  hash?: (value: string) => Promise<string>;
  createWorkbook?: () => ExcelJS.Workbook;
};

export async function prepareBulkCredentialMaterial(
  normalizedRows: readonly BulkRow[],
  dependencies: BulkPreparationDependencies = {},
): Promise<BulkCredentialMaterial> {
  const hash = dependencies.hash ?? passwordHash;
  const preparedRows: PreparedBulkRow[] = [];
  const credentials: { club: string; name: string; role: string; email: string; password: string }[] = [];
  let deputyCount = 0;

  for (const row of normalizedRows) {
    const accounts = [] as PreparedBulkAccount[];
    const sourceAccounts = [
      { name: row.leaderName, email: row.leaderEmail, role: "LEADER" as const },
      ...(row.deputyEmail
        ? [{ name: row.deputyName ?? "副領隊", email: row.deputyEmail, role: "DEPUTY" as const }]
        : []),
    ];
    for (const account of sourceAccounts) {
      const temporaryPassword = randomBytes(18).toString("base64url");
      accounts.push(Object.freeze({
        name: account.name,
        email: account.email,
        role: account.role,
        passwordHash: await hash(temporaryPassword),
      }));
      credentials.push({
        club: row.clubName,
        name: account.name,
        role: account.role === "LEADER" ? "領隊" : "副領隊",
        email: account.email,
        password: temporaryPassword,
      });
      if (account.role === "DEPUTY") deputyCount++;
    }
    preparedRows.push(Object.freeze({ row: Object.freeze({ ...row }), accounts: Object.freeze(accounts) }));
  }

  const workbook = dependencies.createWorkbook?.() ?? new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("臨時帳密");
  sheet.addRow(["社團", "姓名", "角色", "Email", "臨時密碼"]);
  for (const credential of credentials)
    sheet.addRow([credential.club, credential.name, credential.role, credential.email, credential.password].map(safeCell));
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64");
  return Object.freeze({
    rows: Object.freeze(preparedRows),
    count: credentials.length,
    deputyCount,
    file: Object.freeze({
      name: "gokan-初始帳密.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      base64: xlsx,
    }),
  });
}
type BinaryResponse = { setHeader(name: string, value: string): void; status(code: number): { end(body: Buffer): void } };
@Controller("activities/:activityId/accounts")
export class AccountsController {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityService,
  ) {}
  private async admin(request: RequestContext, activityId: string) {
    parse(uuid, activityId);
    const actor = await this.identity.authenticate(request);
    await this.identity.staff(this.db, actor.user.id, activityId, [
      "SYSTEM_ADMIN",
    ]);
    return actor.user.id;
  }
  @Get("bulk-template")
  async bulkTemplate(@Req() request: RequestContext, @Param("activityId") activityId: string, @Res() response: BinaryResponse) {
    await this.admin(request, activityId);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Gokan";
    workbook.created = new Date(0);
    workbook.modified = new Date(0);
    const rows = workbook.addWorksheet("社團與帳號匯入");
    rows.addRow([...bulkColumns]);
    rows.columns.forEach((column) => { column.width = 22; });
    const guide = workbook.addWorksheet("欄位說明");
    guide.addRow(["欄位", "是否必填", "說明", "格式", "範例"]);
    for (const row of [
      ["社團代碼", "是", "年度內唯一的社團識別碼。", "1–30 字；英文、數字、_ 或 -", "DEMO-A"],
      ["社團名稱", "是", "社團完整名稱。", "1–120 字", "範例海風高中"],
      ["社團簡稱", "否", "顯示用簡稱，可留白。", "最多 60 字", "海風"],
      ["領隊姓名", "是", "建立領隊帳號。", "1–120 字", "王小明"],
      ["領隊帳號", "是", "必填；請輸入有效 Email，此 Email 即登入帳號。", "有效 Email", "leader.demo.a@example.invalid"],
      ["副領隊姓名", "否", "建立副領隊時填寫，可留白。", "1–120 字", "陳小華"],
      ["副領隊帳號", "否", "選填；如建立副領隊，請輸入有效且唯一的 Email。", "有效 Email", "deputy.demo.a@example.invalid"],
    ]) guide.addRow(row.map(safeCell));
    guide.addRow(["使用說明", "", "不要修改欄位名稱；一列代表一個社團；匯入前會先預覽；有錯誤的資料不能建立；臨時密碼只會提供一次。", "", ""]);
    guide.columns.forEach((column) => { column.width = 28; });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", "attachment; filename*=UTF-8''gokan-%E7%A4%BE%E5%9C%98%E8%88%87%E5%B8%B3%E8%99%9F%E5%8C%AF%E5%85%A5%E7%AF%84%E6%9C%AC.xlsx");
    response.setHeader("Cache-Control", "private, no-store");
    response.status(200).end(buffer);
  }
  private async previewRows(activityId: string, rows: unknown[]) {
    const parsed = rows.map((item) => bulkRow.safeParse(item));
    const normalizedRows = parsed.filter((result) => result.success).map((result) => normalizeBulkRow(result.data));
    const emailCandidates = [...new Set(normalizedRows.flatMap((item) => [item.leaderEmail, item.deputyEmail].filter((value): value is string => Boolean(value))))];
    const [existing, existingUsers] = await Promise.all([
      this.db.organization.findMany({ where: { activityId }, select: { code: true } }),
      emailCandidates.length
        ? this.db.user.findMany({ where: { normalizedEmail: { in: emailCandidates } }, select: { normalizedEmail: true } })
        : Promise.resolve([] as { normalizedEmail: string }[]),
    ]);
    const existingCodes = new Set(existing.map((item) => item.code.normalize("NFKC").toUpperCase()));
    const existingEmails = new Set(existingUsers.map((item) => normalizeBulkEmail(item.normalizedEmail)));
    const seenCodes = new Set<string>(); const seenEmails = new Set<string>(); const errors: { row: number; message: string }[] = [];
    let valid = 0;
    for (const [index, result] of parsed.entries()) {
      if (!result.success) { errors.push({ row: index + 2, message: "欄位格式不正確" }); continue; }
      const item = normalizeBulkRow(result.data); const code = item.clubCode; const emails = [item.leaderEmail, item.deputyEmail].filter((email): email is string => Boolean(email));
      if (existingCodes.has(code)) errors.push({ row: index + 2, message: "社團代碼已存在" });
      if (seenCodes.has(code)) errors.push({ row: index + 2, message: "檔案內社團代碼重複" });
      if (emails.some((email) => existingEmails.has(email))) errors.push({ row: index + 2, message: "Email 已存在" });
      if (new Set(emails).size !== emails.length || emails.some((email) => seenEmails.has(email))) errors.push({ row: index + 2, message: "檔案內 Email 重複" });
      seenCodes.add(code); emails.forEach((email) => seenEmails.add(email)); if (!errors.some((error) => error.row === index + 2)) valid++;
    }
    const fingerprint = createHash("sha256").update(JSON.stringify(normalizedRows)).digest("hex");
    return { total: rows.length, valid, invalid: rows.length - valid, errors, canCommit: errors.length === 0 && rows.length > 0, fingerprint, rows: normalizedRows };
  }

  private cellText(value: unknown) {
    if (typeof value === "string" || typeof value === "number") return String(value);
    return "";
  }
  @Post("bulk-preview")
  async bulkPreview(@Req() request: RequestContext, @Param("activityId") activityId: string, @Body() input: unknown) {
    await this.admin(request, activityId);
    const rows = parse(z.object({ rows: z.array(z.unknown()).max(100) }).strict(), input).rows;
    return this.previewRows(activityId, rows);
  }

  @Post("bulk-preview-file")
  async bulkPreviewFile(@Req() request: RequestContext, @Param("activityId") activityId: string, @Body() input: unknown) {
    await this.admin(request, activityId);
    const data = parse(z.object({ name: z.string().min(1).max(240), mime: z.string().max(120), base64: z.string().min(1).max(20_000_000) }).strict(), input);
    if (data.mime && data.mime !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") fail("VALIDATION_FAILED", "匯入檔 MIME 類型不符合 XLSX", 422);
    const bytes = Buffer.from(data.base64, "base64");
    if (bytes.length > 10 * 1024 * 1024) fail("UPLOAD_TOO_LARGE", "匯入檔案不可超過 10 MB", 422);
    if (!/\.xlsx$/i.test(data.name) || bytes.subarray(0, 4).toString("binary") !== "PK\x03\x04") fail("VALIDATION_FAILED", "僅接受未損壞的 XLSX 檔案", 422);
    try {
      await inspectXlsxArchive(bytes);
    } catch {
      fail("VALIDATION_FAILED", "活頁簿安全性檢查未通過：請移除外部連結、巨集或過度壓縮內容", 422);
    }
    let workbook: ExcelJS.Workbook;
    try {
      workbook = await loadSpreadsheetWorkbook(bytes);
    } catch {
      fail("VALIDATION_FAILED", "XLSX 檔案損壞或無法解析", 422);
    }
    if (!workbook.worksheets.length || workbook.worksheets.length > 2 || (workbook.worksheets.length === 2 && workbook.worksheets[1]?.name !== "欄位說明")) fail("VALIDATION_FAILED", "匯入檔工作表不符合範本", 422);
    const sheet = workbook.worksheets[0]; if (!sheet || sheet.rowCount > 101 || sheet.columnCount > 7) fail("VALIDATION_FAILED", "匯入資料超過列數或欄數限制", 422);
    const expected = bulkColumns;
    const header = expected.map((_, index) => this.cellText(sheet.getRow(1).getCell(index + 1).value).trim());
    if (header.some((value, index) => value !== expected[index])) fail("VALIDATION_FAILED", "匯入欄位標題不符合範本", 422);
    const rows: unknown[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber); const values = expected.map((_, index) => row.getCell(index + 1).value);
      if (values.every((value) => value === null || value === undefined || value === "")) continue;
      if (values.some((value) => typeof value === "object" || typeof value === "boolean" || (typeof value === "string" && /^[=+\-@]/.test(value)))) fail("VALIDATION_FAILED", `第 ${rowNumber} 列含不安全儲存格`, 422);
      rows.push({ clubCode: this.cellText(values[0]), clubName: this.cellText(values[1]), clubShortName: this.cellText(values[2]) || null, leaderName: this.cellText(values[3]), leaderEmail: this.cellText(values[4]), deputyName: this.cellText(values[5]) || null, deputyEmail: this.cellText(values[6]) || null });
    }
    return this.previewRows(activityId, rows);
  }

  @Post("bulk-commit")
  async bulkCommit(@Req() request: RequestContext, @Param("activityId") activityId: string, @Body() input: unknown) {
    const actor = await this.admin(request, activityId);
    const data = parse(bulkInput, input);
    const parsedRows = parse(z.object({ rows: z.array(bulkRow).max(100) }).strict(), { rows: data.rows });
    const normalizedRows = parsedRows.rows.map(normalizeBulkRow);
    const fingerprint = createHash("sha256").update(JSON.stringify(normalizedRows)).digest("hex");
    if (fingerprint !== data.fingerprint) fail("STALE_VERSION", "匯入資料已變更，請重新預覽後再試");
    if (!normalizedRows.length) fail("VALIDATION_FAILED", "請至少提供一筆社團資料", 422);
    const prepared = await this.prepareBulkCredentialMaterial(normalizedRows);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      await this.identity.staff(tx, actor, activityId, ["SYSTEM_ADMIN"]);
      const codes = normalizedRows.map((row) => row.clubCode);
      const emails = normalizedRows.flatMap((row) => [row.leaderEmail, row.deputyEmail].filter((value): value is string => Boolean(value)));
      if (new Set(codes).size !== codes.length) fail("DUPLICATE_RECORD", "匯入資料含重複社團代碼", 409);
      if (new Set(emails).size !== emails.length) fail("DUPLICATE_RECORD", "匯入資料含重複 Email", 409);
      const [clubs, users] = await Promise.all([
        tx.organization.findMany({ where: { activityId, code: { in: codes } }, select: { code: true } }),
        tx.user.findMany({ where: { normalizedEmail: { in: emails } }, select: { normalizedEmail: true } }),
      ]);
      if (clubs.length) fail("DUPLICATE_RECORD", `社團代碼已存在：${clubs.map((club) => club.code).join("、")}`, 409);
      if (users.length) fail("DUPLICATE_RECORD", `Email 已存在：${users.map((user) => user.normalizedEmail).join("、")}`, 409);
      for (const preparedRow of prepared.rows) {
        const club = await tx.organization.create({ data: { activityId, code: preparedRow.row.clubCode, name: preparedRow.row.clubName, shortName: preparedRow.row.clubShortName ?? null } });
        for (const account of preparedRow.accounts) {
          const user = await tx.user.create({ data: { email: account.email, normalizedEmail: account.email, displayName: account.name, passwordHash: account.passwordHash, status: "ACTIVE", firstLoginRequired: true } });
          await tx.organizationMembership.create({ data: { organizationId: club.id, userId: user.id, role: account.role } });
        }
      }
      
      return { success: true, count: prepared.count, file: prepared.file };
    });
  }
  protected prepareBulkCredentialMaterial(normalizedRows: readonly BulkRow[]) {
    return prepareBulkCredentialMaterial(normalizedRows);
  }
  private async target(tx: Tx, activityId: string, userId: string) {
    parse(uuid, userId);
    const user = await tx.user.findFirst({
      where: {
        id: userId,
        OR: [
          { staffAssignments: { some: { activityId } } },
          {
            organizationMemberships: { some: { organization: { activityId } } },
          },
        ],
      },
      select: publicUser,
    });
    if (!user) fail("NOT_FOUND", "找不到帳號", 404);
    return user;
  }
  private async keepAdmin(tx: Tx, activityId: string, userId: string) {
    if (
      await tx.activityStaff.findFirst({
        where: { activityId, userId, role: "SYSTEM_ADMIN", revokedAt: null },
      })
    ) {
      const other = await tx.activityStaff.count({
        where: {
          activityId,
          userId: { not: userId },
          role: "SYSTEM_ADMIN",
          revokedAt: null,
          user: { status: "ACTIVE" },
        },
      });
      if (!other) fail("LAST_SYSTEM_ADMIN", "必須保留至少一位有效系統管理員");
    }
  }
  @Get()
  async list(
    @Req() request: RequestContext,
    @Param("activityId") activityId: string,
  ) {
    await this.admin(request, activityId);
    return this.db.user.findMany({
      where: {
        OR: [
          { staffAssignments: { some: { activityId } } },
          {
            organizationMemberships: { some: { organization: { activityId } } },
          },
        ],
      },
      select: {
        ...publicUser,
        staffAssignments: { where: { activityId } },
        organizationMemberships: {
          where: { organization: { activityId } },
          include: { organization: { select: { id: true, name: true } } },
        },
      },
      orderBy: { displayName: "asc" },
      take: 500,
    });
  }
  @Post()
  async create(
    @Req() request: RequestContext,
    @Param("activityId") activityId: string,
    @Body() input: unknown,
  ) {
    const actor = await this.admin(request, activityId);
    const data = parse(
      z
        .object({
          email,
          displayName: label,
          temporaryPassword: password,
          assignment,
        })
        .strict(),
      input,
    );
    const encoded = await passwordHash(data.temporaryPassword);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      await this.identity.staff(tx, actor, activityId, ["SYSTEM_ADMIN"]);
      if (data.assignment.kind === "club") {
        const club = await tx.organization.findFirst({
          where: {
            id: data.assignment.organizationId,
            activityId,
            active: true,
          },
        });
        if (!club) fail("NOT_FOUND", "找不到社團", 404);
      }
      const user = await tx.user.create({
        data: {
          email: data.email,
          normalizedEmail: data.email,
          displayName: data.displayName,
          passwordHash: encoded,
        },
        select: publicUser,
      });
      if (data.assignment.kind === "staff")
        await tx.activityStaff.create({
          data: { activityId, userId: user.id, role: data.assignment.role },
        });
      else
        await tx.organizationMembership.create({
          data: {
            organizationId: data.assignment.organizationId,
            userId: user.id,
            role: data.assignment.role,
          },
        });
      
      return user;
    });
  }
  @Patch(":userId")
  async update(
    @Req() request: RequestContext,
    @Param("activityId") activityId: string,
    @Param("userId") userId: string,
    @Body() input: unknown,
  ) {
    const actor = await this.admin(request, activityId);
    const data = parse(
      z.object({ status: z.enum(["ACTIVE", "DISABLED"]), reason }).strict(),
      input,
    );
    return this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      await lock(tx, `user:${userId}`);
      await this.identity.staff(tx, actor, activityId, ["SYSTEM_ADMIN"]);
      await this.target(tx, activityId, userId);
      if (data.status === "DISABLED")
        await this.keepAdmin(tx, activityId, userId);
      const user = await tx.user.update({
        where: { id: userId },
        data: { status: data.status },
        select: publicUser,
      });
      if (data.status === "DISABLED")
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      
      return user;
    });
  }
  @Post(":userId/reset-password")
  async reset(
    @Req() request: RequestContext,
    @Param("activityId") activityId: string,
    @Param("userId") userId: string,
    @Body() input: unknown,
  ) {
    const actor = await this.admin(request, activityId);
    const data = parse(
      z.object({ temporaryPassword: password, reason }).strict(),
      input,
    );
    const encoded = await passwordHash(data.temporaryPassword);
    await this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      await lock(tx, `user:${userId}`);
      await this.identity.staff(tx, actor, activityId, ["SYSTEM_ADMIN"]);
      await this.target(tx, activityId, userId);
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: encoded, firstLoginRequired: true },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      
    });
    return { success: true };
  }
  @Post(":userId/assignment")
  async assign(
    @Req() request: RequestContext,
    @Param("activityId") activityId: string,
    @Param("userId") userId: string,
    @Body() input: unknown,
  ) {
    const actor = await this.admin(request, activityId);
    const data = parse(
      z.object({ assignment, revoked: z.boolean(), reason }).strict(),
      input,
    );
    await this.db.$transaction(async (tx) => {
      await lock(tx, `activity:${activityId}`);
      await this.identity.staff(tx, actor, activityId, ["SYSTEM_ADMIN"]);
      await this.target(tx, activityId, userId);
      const revokedAt = data.revoked ? new Date() : null;
      if (data.assignment.kind === "staff") {
        if (data.revoked || data.assignment.role !== "SYSTEM_ADMIN")
          await this.keepAdmin(tx, activityId, userId);
        await tx.activityStaff.upsert({
          where: { activityId_userId: { activityId, userId } },
          create: { activityId, userId, role: data.assignment.role, revokedAt },
          update: { role: data.assignment.role, revokedAt },
        });
      } else {
        const club = await tx.organization.findFirst({
          where: { id: data.assignment.organizationId, activityId },
        });
        if (!club) fail("NOT_FOUND", "找不到社團", 404);
        await tx.organizationMembership.upsert({
          where: { organizationId_userId: { organizationId: club.id, userId } },
          create: {
            organizationId: club.id,
            userId,
            role: data.assignment.role,
            revokedAt,
          },
          update: { role: data.assignment.role, revokedAt },
        });
      }
      
    });
    return { success: true };
  }
}
