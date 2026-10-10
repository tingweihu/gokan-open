"use client";
import { state } from "./demo-state";

type Cell = string | number | null | undefined;
type Sheet = { name: string; rows: Cell[][] };
const encoder = new TextEncoder();
const xml = (value: Cell) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const csvCell = (value: Cell) => {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
};
function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = href; anchor.download = filename; document.body.appendChild(anchor); anchor.click();
  window.setTimeout(() => { anchor.remove(); URL.revokeObjectURL(href); }, 1000);
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: { name: string; data: Uint8Array }[]) {
  const chunks: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);
  for (const file of files) {
    const name = encoder.encode(file.name), size = file.data.length, checksum = crc32(file.data);
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x800); u16(lv, 8, 0);
    u32(lv, 14, checksum); u32(lv, 18, size); u32(lv, 22, size); u16(lv, 26, name.length); local.set(name, 30);
    chunks.push(local, file.data);
    const dir = new Uint8Array(46 + name.length), dv = new DataView(dir.buffer);
    u32(dv, 0, 0x02014b50); u16(dv, 4, 20); u16(dv, 6, 20); u16(dv, 8, 0x800);
    u32(dv, 16, checksum); u32(dv, 20, size); u32(dv, 24, size); u16(dv, 28, name.length);
    u32(dv, 42, offset); dir.set(name, 46); central.push(dir);
    offset += local.length + size;
  }
  const directoryLength = central.reduce((n, part) => n + part.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 8, files.length); u16(ev, 10, files.length);
  u32(ev, 12, directoryLength); u32(ev, 16, offset);
  return new Blob([...chunks, ...central, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function xlsx(sheets: Sheet[]) {
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
  const relations = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`;
  const content = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const entries = [
    { name: "[Content_Types].xml", data: encoder.encode(content) },
    { name: "_rels/.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(relations) },
    ...sheets.map((sheet, si) => ({ name: `xl/worksheets/sheet${si + 1}.xml`, data: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet.rows.map((row, ri) => `<row r="${ri + 1}">${row.map((cell, ci) => `<c r="${column(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`) })),
  ];
  return zip(entries);
}
function column(index: number) { let name = ""; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; }

export function downloadDemo(kind: "roster" | "checkin" | "annual" | "final" | "template", format: "csv" | "xlsx", clubId?: string, eventId?: string) {
  const s = state();
  let sheets: Sheet[];
  if (kind === "template") sheets = [{ name: "示範匯入範本", rows: [["DEMO", "選手姓名", "性別", "年級"], ["DEMO", "示範匯入選手 061", "MALE", "GRADE_1"]] }];
  else if (kind === "roster") sheets = [{ name: "示範選手名單", rows: [["DEMO", "社團", "選手姓名", "性別", "年級"],
    ...s.participants.filter(p => p.active && (!clubId || clubId === "all" || p.sourceOrganizationId === clubId)).map(p => ["DEMO", p.sourceOrganization.name, p.name, p.gender, p.grade])] }];
  else if (kind === "checkin" || kind === "final") sheets = [{ name: kind === "final" ? "示範最終參賽資料" : "示範檢錄名單", rows: [["DEMO", "賽事項目", "隊伍", "選手姓名", "年級", "性別"],
    ...s.registrations.filter(r => r.status === "CONFIRMED").flatMap(r => r.eventEntries.filter((entry: any) => !eventId || entry.eventId === eventId)
      .flatMap((entry: any) => entry.teams.filter((team: any) => team.admissionStatus === "ADMITTED")
        .flatMap((team: any) => team.members.filter((m: any) => s.participants.some(p => p.id === m.participantId && p.active)).map((m: any) => ["DEMO", entry.event.name, team.ordinal === 1 ? "A 隊" : "B 隊", s.participants.find(p => p.id === m.participantId)?.name, s.participants.find(p => p.id === m.participantId)?.grade, s.participants.find(p => p.id === m.participantId)?.gender]))))] }];
  else sheets = [
    { name: "示範社團", rows: [["DEMO", "社團代碼", "社團名稱"], ...s.clubs.map(c => ["DEMO", c.code, c.name])] },
    { name: "示範選手", rows: [["DEMO", "來源社團", "選手姓名", "年級", "性別"], ...s.participants.map(p => ["DEMO", p.sourceOrganization.name, p.name, p.grade, p.gender])] },
    { name: "示範報名", rows: [["DEMO", "報名單位", "狀態"], ...s.registrations.map(r => ["DEMO", r.organization?.name ?? r.league?.name, r.status])] },
    { name: "示範付款", rows: [["DEMO", "報名單位", "金額", "狀態"], ...s.payments.map(p => ["DEMO", s.registrations.find(r => r.id === p.registrationId)?.organization?.name, p.amount, p.status])] },
  ];
  if (format === "csv") {
    const content = "\ufeff" + sheets[0]!.rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    saveBlob(new Blob([content], { type: "text/csv;charset=utf-8" }), `Gokan-${kind}-DEMO.csv`);
  } else saveBlob(xlsx(sheets), `Gokan-${kind}-DEMO.xlsx`);
}
