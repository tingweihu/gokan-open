import ExcelJS from "exceljs";
import JSZip from "jszip";
import { fromBufferPromise } from "yauzl";
import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;
export const MAX_CELL_LENGTH = 1000;
export const uploadSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(150)
      .regex(/\.(csv|xlsx)$/i),
    mime: z.enum([
      "text/csv",
      "application/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "",
    ]),
    base64: z
      .string()
      .min(4)
      .max(Math.ceil(MAX_FILE_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict();
export const participantData = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .transform((v) => v.normalize("NFKC")),
    gender: z.enum(["MALE", "FEMALE"]),
    grade: z.enum(["GRADE_1", "GRADE_2", "GRADE_3"]),
  })
  .strict();
export type ParticipantInput = z.infer<typeof participantData>;
export type RowError = {
  row: number;
  field: string;
  value: string;
  message: string;
};
export type ImportResult = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: ParticipantInput[];
  sourceRows: number[];
  errors: RowError[];
};
const normalize = (v: unknown): string =>
  typeof v === "string" || typeof v === "number"
    ? String(v).normalize("NFKC").trim()
    : "";
export function normalizeRows(rows: unknown[][]): ImportResult {
  if (!rows.length || rows.length > MAX_IMPORT_ROWS + 1)
    throw new Error("名單必須有標題且最多 2000 位選手");
  const heading = rows[0]?.map(normalize);
  if (heading?.length !== 3 || heading.join("|") !== "姓名|性別|年級")
    throw new Error("請使用三欄標題：姓名、性別、年級");
  const result: ImportResult = {
    totalRows: rows.length - 1,
    validRows: 0,
    invalidRows: 0,
    rows: [], sourceRows: [],
    errors: [],
  };
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const fields = row.map(normalize);
    const gender = (
      {
        男: "MALE",
        男生: "MALE",
        男性: "MALE",
        女: "FEMALE",
        女生: "FEMALE",
        女性: "FEMALE",
        male: "MALE",
        female: "FEMALE",
      } as Record<string, string>
    )[fields[1]?.toLowerCase() ?? ""];
    const grade = (
      {
        "1": "GRADE_1",
        一: "GRADE_1",
        一年級: "GRADE_1",
        "2": "GRADE_2",
        二: "GRADE_2",
        二年級: "GRADE_2",
        "3": "GRADE_3",
        三: "GRADE_3",
        三年級: "GRADE_3",
      } as Record<string, string>
    )[fields[2] ?? ""];
    const data = participantData.safeParse({ name: fields[0], gender, grade });
    const key = data.success
      ? JSON.stringify([data.data.name, data.data.gender, data.data.grade])
      : fields.join("|");
    const oversizedCell = fields.some((field) => field.length > MAX_CELL_LENGTH);
    if (
      !data.success ||
      row.length !== 3 ||
      oversizedCell ||
      seen.has(key) ||
      row.some((c) => typeof c === "object" && c !== null)
    ) {
      result.invalidRows++;
      if (!data.success)
        for (const issue of data.error.issues)
          result.errors.push({
            row: i + 1,
            field: ({ name: "姓名", gender: "性別", grade: "年級" } as Record<string, string>)[String(issue.path[0])] ?? "資料列",
            value:
              fields[
                ["name", "gender", "grade"].indexOf(String(issue.path[0]))
              ]?.slice(0, 120) ?? "",
            message: oversizedCell
              ? "儲存格文字超過 1000 字限制"
              : "姓名最多120字；性別請填男/女；年級請填1/2/3",
          });
      else
        result.errors.push({
          row: i + 1,
          field: "資料列",
          value: fields.slice(0, 3).join(" / ").slice(0, 120),
          message: oversizedCell
            ? "儲存格文字超過 1000 字限制"
            : seen.has(key)
              ? "檔案中有重複選手"
              : "僅接受三欄純文字資料，不接受公式或連結",
        });
    } else {
      result.validRows++;
      result.rows.push(data.data); result.sourceRows.push(i + 1);
    }
    seen.add(key);
  }
  return result;
}
export async function inspectXlsxArchive(buffer: Buffer) {
  const zip = await fromBufferPromise(buffer, {
    lazyEntries: true,
    validateEntrySizes: true,
    strictFileNames: true,
  });
  let total = 0;
  let count = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      const isAllowedPrinterSettings =
        /^xl\/printerSettings\/printerSettings\d+\.bin$/i.test(entry.fileName);
      const isBlockedBinary =
        /\.bin$/i.test(entry.fileName) && !isAllowedPrinterSettings;
      if (
        ++count > 100 ||
        entry.isEncrypted() ||
        entry.uncompressedSize > 16 * 1024 * 1024 ||
        entry.uncompressedSize > Math.max(1, entry.compressedSize) * 100 ||
        /(?:externalLinks|embeddings|vbaProject)/i.test(entry.fileName) ||
        isBlockedBinary
      )
        throw new Error("不支援含外部連結、巨集或過度壓縮的活頁簿");
      const stream = await zip.openReadStreamPromise(entry);
      const xml: Buffer[] = [];
      for await (const chunk of stream) {
        const bytes = chunk as Buffer;
        total += bytes.length;
        if (total > 16 * 1024 * 1024) {
          stream.destroy();
          throw new Error("活頁簿解壓縮後超過限制");
        }
        if (/\.xml$|\.rels$/.test(entry.fileName)) xml.push(bytes);
      }
      if (
        /<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External/i.test(
          Buffer.concat(xml).toString("utf8"),
        )
      )
        throw new Error("活頁簿不可含外部資源");
    }
  } finally {
    zip.close();
  }
}

/**
 * ExcelJS 4.x's XML transforms match unprefixed element names.  Some valid
 * OOXML producers emit the same namespace with a prefix (for example
 * <x:workbook>).  After inspectXlsxArchive has accepted the package, strip
 * only element-name prefixes in memory so those files can be parsed without
 * changing the stored workbook or relaxing any archive checks.
 */
async function normalizePrefixedXml(buffer: Buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    let changed = false;
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !/\.(?:xml|rels)$/i.test(name)) continue;
      const source = await entry.async("string");
      const normalized = source.replace(
        /(<\/?)[A-Za-z_][\w.-]*:/g,
        "$1",
      );
      if (normalized !== source) {
        changed = true;
        zip.file(name, normalized);
      }
    }
    if (!changed) return null;
    return Buffer.from(
      await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    );
  } catch {
    return null;
  }
}

export async function loadSpreadsheetWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    return workbook;
  } catch (directError) {
    const normalized = await normalizePrefixedXml(buffer);
    if (!normalized) throw directError;
    const fallback = new ExcelJS.Workbook();
    await fallback.xlsx.load(normalized as unknown as ExcelJS.Buffer);
    return fallback;
  }
}
export async function decodeSpreadsheet(input: z.infer<typeof uploadSchema>) {
  const buffer = Buffer.from(input.base64, "base64");
  if (!buffer.length || buffer.length > MAX_FILE_BYTES)
    throw new Error("檔案上限為 4 MB");
  let rows: unknown[][];
  if (/\.xlsx$/i.test(input.name)) {
    if (
      input.mime &&
      input.mime !==
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
      throw new Error("副檔名與格式不一致");
    if (buffer.readUInt32LE(0) !== 0x04034b50) throw new Error("不是有效 XLSX");
    await inspectXlsxArchive(buffer);
    const book = await loadSpreadsheetWorkbook(buffer);
    if (book.worksheets.length !== 1) throw new Error("請保留一個名單工作表");
    const sheet = book.worksheets[0]!;
    if (sheet.rowCount > MAX_IMPORT_ROWS + 1 || sheet.columnCount > 3)
      throw new Error("名單最多2000列、3欄");
    rows = [];
    for (let row = 1; row <= sheet.rowCount; row++)
      rows.push([1, 2, 3].map((column) => sheet.getCell(row, column).value));
  } else {
    if (
      input.mime &&
      !["text/csv", "application/csv", "application/vnd.ms-excel"].includes(
        input.mime,
      )
    )
      throw new Error("副檔名與格式不一致");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    rows = parseCsv(text, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 1000,
      relax_column_count: true,
    }) as unknown[][];
  }
  return normalizeRows(rows);
}
export function safeCell(value: unknown) {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r\n]/.test(value) ? "'" + value : value;
}
export async function rosterTemplate() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("選手名單");
  sheet.addRow(["姓名", "性別", "年級"]);
  sheet.columns.forEach((c) => {
    c.width = 24;
  });
  return Buffer.from(await book.xlsx.writeBuffer()).toString("base64");
}
