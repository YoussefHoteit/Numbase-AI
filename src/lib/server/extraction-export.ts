import ExcelJS from "exceljs";
import { INVOICE_FIELDS, type Extraction } from "../extractions.ts";

export async function extractionWorkbook(result: Extraction): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Numbase AI";
  const sheet = workbook.addWorksheet(result.kind === "invoice" ? "Invoice" : "Table");
  if (result.kind === "invoice") {
    sheet.addRow(["Field", "Value", "Source", "Original quote"]);
    for (const [key, label] of Object.entries(INVOICE_FIELDS)) {
      const field = result.data.fields[key as keyof typeof INVOICE_FIELDS];
      sheet.addRow([label, field.value, result.sources.find((source) => source.index === field.evidence?.chunk)?.location ?? "", field.evidence?.quote ?? ""]);
    }
    const lines = workbook.addWorksheet("Line items");
    lines.addRow(["Description", "Quantity", "Unit price", "Amount", "Source", "Original quote"]);
    result.data.lineItems.forEach((row) => lines.addRow([row.description, row.quantity, row.unitPrice, row.amount,
      result.sources.find((source) => source.index === row.evidence.chunk)?.location ?? "", row.evidence.quote]));
  } else {
    sheet.addRow([...result.data.columns, "Source", "Original quote"]);
    result.data.rows.forEach((row) => sheet.addRow([...row.cells,
      result.sources.find((source) => source.index === row.evidence.chunk)?.location ?? "", row.evidence.quote]));
  }
  const notes = workbook.addWorksheet("Read me");
  notes.addRows([
    ["Source file", result.filename], ["Extraction model", result.model],
    ["Review", "Review values against the original. Source quotes do not validate user edits. Numbers and dates are text, not recalculated values."],
    ["Edited", result.edited ? "Yes" : "No"], ["Rows omitted", result.data.truncated ? "Yes — review the source" : "Not reported by the model"],
    ["Source coverage", result.scope ? `Sections ${result.scope.start}–${result.scope.end} of ${result.scope.totalSections} — ${result.scope.complete ? "whole indexed file" : "selected range only; other sections were not extracted"}` : "Coverage was not recorded for this older result."],
    ...result.data.warnings.map((warning) => ["Warning", warning]),
  ]);
  for (const tab of workbook.worksheets) {
    tab.views = [{ state: "frozen", ySplit: 1 }];
    tab.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    tab.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF314538" } };
    tab.columns.forEach((column) => { column.width = 28; });
    tab.eachRow((row) => row.eachCell((cell) => {
      // All user/AI content is assigned as strings, never formula or hyperlink objects.
      cell.alignment = { vertical: "top", wrapText: true };
    }));
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
