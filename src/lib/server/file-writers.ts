import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileDraftSchema, FILE_LIMITS, type FileDraft } from "../generated-files.ts";
import { RequestError } from "./request.ts";

async function word(draft: FileDraft) {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, HeadingLevel, WidthType } = await import("docx");
  const paragraphs = (text: string) => text.split("\n").map((line) => new Paragraph({ text: line, spacing: { after: 120 } }));
  const children = [
    ...(draft.title ? [new Paragraph({ text: draft.title, heading: HeadingLevel.TITLE })] : []),
    ...draft.paragraphs.flatMap(paragraphs),
    ...(draft.columns.length ? [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [draft.columns, ...draft.rows].map((row, index) => new TableRow({ tableHeader: index === 0, children: row.map((cell) => new TableCell({ children: paragraphs(cell) })) })) })] : []),
  ];
  return Packer.toBuffer(new Document({ creator: "Numbase", title: draft.title, sections: [{ children }] }));
}

async function spreadsheet(draft: FileDraft) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Numbase";
  const sheet = workbook.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(draft.columns);
  draft.rows.forEach((row) => sheet.addRow(row));
  // All cells are literal strings, including values beginning with '='. Never run formulas.
  sheet.columns.forEach((column) => { column.width = 24; });
  sheet.eachRow((row, index) => { row.alignment = { vertical: "top", wrapText: true }; if (index === 1) row.font = { bold: true }; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: draft.columns.length } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function pdf(draft: FileDraft) {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const { default: fontkit } = await import("@pdf-lib/fontkit");
  const doc = await PDFDocument.create();
  doc.setTitle(draft.title); doc.setCreator("Numbase");
  doc.registerFontkit(fontkit);
  // Bundle the licensed font; generation never fetches fonts or external URLs.
  const font = await doc.embedFont(await readFile(path.join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf")), { subset: true });
  const supported = new Set(font.getCharacterSet());
  const all = [draft.title, ...draft.paragraphs, ...draft.columns, ...draft.rows.flat()].join("\n");
  if ([...all].some((char) => char !== "\n" && char !== "\t" && !supported.has(char.codePointAt(0)!)) || /[\u0590-\u08ff]/u.test(all))
    throw new RequestError("PDF export cannot lay out this script yet. Request a Word file to preserve the text.", 400);
  let page = doc.addPage([595.28, 841.89]);
  let y = 790;
  const width = 491;
  function line(text: string, size: number) {
    if (y < 55 + size) {
      if (doc.getPageCount() >= 60) throw new RequestError("This PDF needs too many pages. Request a smaller file.", 413);
      page = doc.addPage([595.28, 841.89]); y = 790;
    }
    page.drawText(text, { x: 52, y, size, font, color: rgb(0.12, 0.14, 0.16) });
    y -= size * 1.5;
  }
  function paragraph(text: string, size = 11) {
    for (const source of text.replaceAll("\t", "    ").split("\n")) {
      let current = "";
      // Character fallback also wraps URLs, long code-like strings, and unbroken words.
      for (const char of source) {
        if (current && font.widthOfTextAtSize(current + char, size) > width) { line(current, size); current = ""; }
        current += char;
      }
      line(current, size);
    }
    y -= 8;
  }
  if (draft.title) paragraph(draft.title, 20);
  draft.paragraphs.forEach((text) => paragraph(text));
  // PDF tables are readable labeled rows rather than screenshots or clipped wide grids.
  draft.rows.forEach((row, index) => paragraph(`${index + 1}. ${row.map((cell, col) => `${draft.columns[col]}: ${cell}`).join("  |  ")}`, 10));
  return Buffer.from(await doc.save());
}

export async function writeGeneratedFile(value: FileDraft) {
  const parsed = fileDraftSchema.safeParse(value);
  if (!parsed.success) throw new RequestError("The file content is invalid or too large. Ask for a smaller, simpler file.", 400);
  const draft = parsed.data;
  const bytes = draft.format === "docx" ? await word(draft) : draft.format === "xlsx" ? await spreadsheet(draft) : draft.format === "pdf" ? await pdf(draft) : Buffer.from(draft.code, "utf8");
  if (!bytes.length || bytes.length > FILE_LIMITS.bytes) throw new RequestError("The generated file is too large. Request a smaller file.", 413);
  return bytes;
}
