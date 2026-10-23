import { DOCUMENT_LIMITS, documentKind, type DocumentKind, type DocumentSection } from "../documents.ts";
import { RequestError } from "./request.ts";
import { fromBuffer } from "yauzl";

// DOCX and XLSX are ZIP containers. Inspect the directory before a parser inflates it.
export async function inspectOfficeArchive(bytes: Buffer, kind: "docx" | "xlsx") {
  return new Promise<void>((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, archive) => {
      if (error || !archive) return reject(new RequestError("This Office file is damaged or unsupported.", 400));
      let total = 0;
      let expanded = 0;
      let count = 0;
      let content = false;
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        archive.close();
        reject(new RequestError("This Office file is encrypted, unsafe, or too large when expanded.", 400));
      };
      archive.on("error", fail);
      archive.on("entry", (entry) => {
        total += entry.uncompressedSize;
        count++;
        const unsafe = /(?:^|\/)\.\.(?:\/|$)|^\/|\\|vbaProject\.bin$/i.test(entry.fileName);
        if (unsafe || (entry.generalPurposeBitFlag & 1) || total > DOCUMENT_LIMITS.expandedBytes || count > DOCUMENT_LIMITS.entries) return fail();
        if (entry.fileName === (kind === "docx" ? "word/document.xml" : "xl/workbook.xml")) content = true;
        // Check actual inflated bytes too: a forged directory must not bypass the budget.
        archive.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail();
          stream.on("error", fail);
          stream.on("data", (chunk: Buffer) => {
            expanded += chunk.length;
            if (expanded > DOCUMENT_LIMITS.expandedBytes) { stream.destroy(); fail(); }
          });
          stream.on("end", () => { if (!settled) archive.readEntry(); });
        });
      });
      archive.on("end", () => {
        if (settled) return;
        settled = true;
        if (content) resolve();
        else reject(new RequestError("The file contents do not match its Office extension.", 400));
      });
      archive.readEntry();
    });
  });
}

function textSections(text: string): DocumentSection[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sections: DocumentSection[] = [];
  for (let start = 0; start < lines.length; start += 50) {
    sections.push({ location: `lines ${start + 1}–${Math.min(start + 50, lines.length)}`, text: lines.slice(start, start + 50).join("\n") });
  }
  return sections;
}

export async function parseDocument(bytes: Buffer, filename: string): Promise<{ sections: DocumentSection[]; warnings: string[]; kind: DocumentKind }> {
  if (!bytes.length || bytes.length > DOCUMENT_LIMITS.bytes) throw new RequestError("Documents must be 20 MB or smaller.", 413);
  const kind = documentKind(filename);
  if (!kind) throw new RequestError("That file format is not supported.", 400);
  let sections: DocumentSection[] = [];
  const warnings: string[] = [];
  try {
    if (kind === "pdf") {
      if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new RequestError("This file is not a valid PDF.", 400);
      const { getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes), { enableXfa: false, useWorkerFetch: false });
      try {
        if (pdf.numPages > DOCUMENT_LIMITS.pages) throw new RequestError("PDFs can contain up to 300 pages. Split this file before uploading.", 413);
        let characters = 0;
        let empty = 0;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          const text = content.items.flatMap((item) => "str" in item ? [item.str + (item.hasEOL ? "\n" : " ")] : []).join("");
          characters += text.length;
          if (characters > DOCUMENT_LIMITS.characters) throw new RequestError("This document contains too much text. Split it into smaller files.", 413);
          if (!text.trim()) empty++;
          sections.push({ location: `page ${pageNumber}`, text });
          page.cleanup();
        }
        if (empty) warnings.push(`${empty} page(s) have no extractable text. Scans and text inside images need OCR; those pages are not indexed.`);
      } finally { await pdf.loadingTask.destroy(); }
    } else if (kind === "docx") {
      await inspectOfficeArchive(bytes, kind);
      const { extractRawText } = await import("mammoth");
      const parsed = await extractRawText({ buffer: bytes });
      sections = parsed.value.split(/\n\s*\n/).map((text, index) => ({ location: `paragraph ${index + 1}`, text }));
      if (parsed.messages.length) warnings.push("Some Word formatting or objects could not be read. Check the original file.");
    } else if (kind === "xlsx") {
      await inspectOfficeArchive(bytes, kind);
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes as never, { ignoreNodes: ["drawing", "picture", "extLst"] });
      let rows = 0;
      let characters = 0;
      let formulas = false;
      for (const sheet of workbook.worksheets) {
        sheet.eachRow((row, number) => {
          if (++rows > DOCUMENT_LIMITS.rows || row.cellCount > DOCUMENT_LIMITS.columns) throw new RequestError("Spreadsheets support up to 50,000 populated rows and 100 columns.", 413);
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell, column) => {
            if (cell.formula) formulas = true;
            // Cached formula results are read; uploaded formulas are never executed.
            cells.push(`${column}: ${cell.text}`);
          });
          const text = cells.join(" | ");
          characters += text.length;
          if (characters > DOCUMENT_LIMITS.characters) throw new RequestError("This spreadsheet contains too much text. Split it into smaller files.", 413);
          sections.push({ location: `${sheet.name}, row ${number}`, text });
        });
      }
      if (formulas) warnings.push("Formula values use the workbook's saved results. Formulas are not recalculated.");
      // Group nearby rows so each embedding has enough context without losing sheet boundaries.
      sections = groupRows(sections);
    } else {
      if (bytes.includes(0)) throw new RequestError("This file contains binary data. Upload a UTF-8 text file.", 400);
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new RequestError("Save this file as UTF-8 text before uploading.", 400); }
      if (text.length > DOCUMENT_LIMITS.characters) throw new RequestError("This document contains too much text. Split it into smaller files.", 413);
      if (kind === "csv") {
        const { parse } = await import("csv-parse/sync");
        const rows: string[][] = parse(text, { bom: true, skip_empty_lines: true, max_record_size: 100_000, to: DOCUMENT_LIMITS.rows + 1 });
        if (rows.length > DOCUMENT_LIMITS.rows || rows.some((row) => row.length > DOCUMENT_LIMITS.columns)) throw new RequestError("Spreadsheets support up to 50,000 rows and 100 columns.", 413);
        sections = groupRows(rows.map((row, index) => ({ location: `CSV, row ${index + 1}`, text: row.map((cell, column) => `${column + 1}: ${cell}`).join(" | ") })));
      } else sections = textSections(text);
    }
    if (sections.reduce((sum, section) => sum + section.text.length, 0) > DOCUMENT_LIMITS.characters) throw new RequestError("This document contains too much text. Split it into smaller files.", 413);
    sections = sections.filter((section) => section.text.trim());
    if (!sections.length) throw new RequestError("No readable text was found. Scanned PDFs need OCR; upload a text-based document or use image analysis for individual pages.", 422);
    return { sections, warnings, kind };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("This file could not be read. It may be damaged, encrypted, or unsupported. Try exporting a fresh copy.", 422);
  }
}

function groupRows(rows: DocumentSection[]) {
  const sections: DocumentSection[] = [];
  let group: DocumentSection | undefined;
  for (const row of rows) {
    const sheet = row.location.split(", row ")[0];
    if (!group || group.text.length + row.text.length > 3500 || !group.location.startsWith(`${sheet}, row `)) {
      group = { ...row };
      sections.push(group);
    } else {
      group.text += `\n[${row.location}] ${row.text}`;
    }
  }
  return sections;
}
