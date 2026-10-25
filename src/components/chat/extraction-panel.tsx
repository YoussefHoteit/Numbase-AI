"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Save, Table2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EXTRACTION_LIMITS, INVOICE_FIELDS, extractionSchema, type Extraction, type InvoiceField } from "@/lib/extractions";

type Props = {
  conversationId: string;
  documentId: string;
  filename: string;
  disabled: boolean;
  initial?: Extraction;
  chunkCount?: number;
  onSave: (result: Extraction) => boolean;
};

export function ExtractionPanel({ conversationId, documentId, filename, disabled, initial, chunkCount, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"invoice" | "table">("invoice");
  const [useRange, setUseRange] = useState(false);
  const [start, setStart] = useState("1");
  const [end, setEnd] = useState(String(Math.min(chunkCount ?? 8, 8)));
  const [result, setResult] = useState<Extraction | null>(null);
  const [busy, setBusy] = useState<"extract" | "download" | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const downloading = useRef(false);
  useEffect(() => () => { abort.current?.abort(); }, []);
  const view = result ?? initial;
  function changeOpen(next: boolean) {
    if (!next) { abort.current?.abort(); setBusy(null); }
    setOpen(next);
  }
  async function extract() {
    const selectedRange = useRange || (chunkCount ?? 0) > EXTRACTION_LIMITS.chunks;
    const range = selectedRange ? { start: Number(start), end: Number(end) } : undefined;
    if (range && (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 1 || range.end < range.start || range.end - range.start + 1 > EXTRACTION_LIMITS.chunks || range.end > (chunkCount ?? 800))) {
      setError("Choose up to 12 consecutive sections within this file."); return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setBusy("extract"); setError("");
    try {
      const response = await fetch(`/api/documents/${documentId}/extract`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ conversationId, kind, ...(range ? { range } : {}) }),
      });
      if (!response.ok) throw new Error(await response.text());
      const next = extractionSchema.parse(await response.json());
      if (!controller.signal.aborted) setResult(next);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Extraction failed. Please try again.");
    } finally { if (!controller.signal.aborted) setBusy(null); }
  }
  function edit(change: (draft: Extraction) => void) {
    if (!view) return;
    const draft = structuredClone(view);
    change(draft); draft.edited = true;
    setResult(draft); setError("");
  }
  async function download(format: "json" | "xlsx") {
    if (!view || downloading.current) return;
    const checked = extractionSchema.safeParse(view);
    if (!checked.success) { setError("The result is too large or invalid. Shorten your edits before downloading."); return; }
    downloading.current = true; setBusy("download"); setError("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await fetch(`/api/documents/${documentId}/export`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ conversationId, result: checked.data, format }),
      });
      if (!response.ok) throw new Error(await response.text());
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `numbase-${view.kind}.${format}`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Download failed.");
    } finally { downloading.current = false; if (!controller.signal.aborted) setBusy(null); }
  }
  const source = (chunk?: number) => view?.sources.find((item) => item.index === chunk)?.location ?? "Not found";
  return <>
    <button type="button" disabled={disabled} onClick={() => { setError(""); changeOpen(true); }}>
      <Table2 size={14} />{initial ? "Review & download" : result ? "Review extraction" : "Extract data"}
    </button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="extraction-panel">
        <div className="extraction-heading">
          <span className="extraction-eyebrow">WORK WITH YOUR FILE</span>
          <DialogTitle>{view ? "Review extracted data" : "Extract structured data"}</DialogTitle>
          <DialogDescription>{filename}</DialogDescription>
        </div>
        <div className="extraction-body">
          {!view ? <>
            <fieldset className="extraction-options" disabled={!!busy}>
              <legend>What would you like to extract?</legend>
              <label><input type="radio" name={`kind-${documentId}`} checked={kind === "invoice"} onChange={() => setKind("invoice")} />
                <span><strong>Invoice fields</strong><small>Supplier, dates, totals, and line items</small></span></label>
              <label><input type="radio" name={`kind-${documentId}`} checked={kind === "table"} onChange={() => setKind("table")} />
                <span><strong>A table</strong><small>Columns and rows, ready for a spreadsheet</small></span></label>
            </fieldset>
            <fieldset className="extraction-range" disabled={!!busy}>
              <legend>Source coverage{chunkCount ? ` · ${chunkCount} sections` : ""}</legend>
              <label><input type="checkbox" checked={useRange || (chunkCount ?? 0) > EXTRACTION_LIMITS.chunks} disabled={(chunkCount ?? 0) > EXTRACTION_LIMITS.chunks} onChange={(event) => setUseRange(event.target.checked)} />Choose a section range</label>
              {(useRange || (chunkCount ?? 0) > EXTRACTION_LIMITS.chunks) && <div>
                <label>From section<input type="number" min={1} max={chunkCount ?? 800} value={start} onChange={(event) => { setStart(event.target.value); setError(""); }} /></label>
                <label>To section<input type="number" min={1} max={chunkCount ?? 800} value={end} onChange={(event) => { setEnd(event.target.value); setError(""); }} /></label>
              </div>}
              <small>Up to 12 sections per extraction. Section numbers refer to the file index, not page numbers. Ask the chat to locate a table or invoice first.</small>
            </fieldset>
            <p className="extraction-note">Uses GPT-4.1 Mini. One file or selected range at a time, up to 32,000 source characters and {EXTRACTION_LIMITS.rows} rows. Missing values stay empty. Extraction uses your provider allowance.</p>
          </> : <>
            <div className="extraction-status"><span>{view.kind === "invoice" ? "Invoice fields" : "Table"} · GPT-4.1 Mini</span><span>{view.edited ? "Includes your edits" : "Ready for review"}</span></div>
            {view.scope && <p className="extraction-note">Sections {view.scope.start}–{view.scope.end} of {view.scope.totalSections} · {view.scope.complete ? "Whole indexed file" : "Selected range only; other sections were not extracted"}</p>}
            <p className="extraction-note">Check values against the original before using them. Quotes show the original evidence; they do not validate your edits. Amounts and dates keep their source formatting.</p>
            {view.data.truncated && <p className="extraction-warning" role="status">Some rows or columns were omitted. Review the original for the full table.</p>}
            {view.data.warnings.map((warning, index) => <p className="extraction-warning" key={index}>{warning}</p>)}
            {view.kind === "invoice" && <div className="extraction-fields">
              {(Object.entries(INVOICE_FIELDS) as [InvoiceField, string][]).map(([key, label]) => <label key={key}>
                <span>{label}</span><input value={view.data.fields[key].value ?? ""} maxLength={500} placeholder="Not found" disabled={!!busy}
                  onChange={(event) => edit((draft) => { if (draft.kind === "invoice") draft.data.fields[key].value = event.target.value || null; })} />
                <small title={view.data.fields[key].evidence?.quote}>{source(view.data.fields[key].evidence?.chunk)}</small>
              </label>)}
            </div>}
            {(view.kind === "table" || view.data.lineItems.length > 0) && <div className="extraction-table-scroll" tabIndex={0} role="region" aria-label="Editable extracted table">
              <table><caption>{view.kind === "table" ? "Extracted table" : "Line items"}</caption><thead><tr>
                {(view.kind === "table" ? view.data.columns : ["Description", "Quantity", "Unit price", "Amount"]).map((column, index) => <th key={index} scope="col">{column}</th>)}<th scope="col">Source</th>
              </tr></thead><tbody>
                {view.kind === "table" ? view.data.rows.map((row, rowIndex) => <tr key={rowIndex}>
                  {row.cells.map((cell, columnIndex) => <td key={columnIndex}><input aria-label={`Row ${rowIndex + 1}, ${view.data.columns[columnIndex]}`} value={cell ?? ""} maxLength={500} disabled={!!busy}
                    onChange={(event) => edit((draft) => { if (draft.kind === "table") draft.data.rows[rowIndex].cells[columnIndex] = event.target.value || null; })} /></td>)}
                  <td title={row.evidence.quote}>{source(row.evidence.chunk)}</td>
                </tr>) : view.data.lineItems.map((row, rowIndex) => <tr key={rowIndex}>
                  {(["description", "quantity", "unitPrice", "amount"] as const).map((key) => <td key={key}><input aria-label={`Line item ${rowIndex + 1}, ${key}`} value={row[key] ?? ""} maxLength={500} disabled={!!busy}
                    onChange={(event) => edit((draft) => { if (draft.kind === "invoice") draft.data.lineItems[rowIndex][key] = event.target.value || null; })} /></td>)}
                  <td title={row.evidence.quote}>{source(row.evidence.chunk)}</td>
                </tr>)}
              </tbody></table>
            </div>}
            <details className="extraction-evidence"><summary>Original evidence</summary>
              {view.kind === "invoice" ? <>{Object.entries(view.data.fields).flatMap(([key, field]) => field.evidence ? [<p key={key}><strong>{INVOICE_FIELDS[key as InvoiceField]} · {source(field.evidence.chunk)}</strong><br />{field.evidence.quote}</p>] : [])}
                {view.data.lineItems.map((row, index) => <p key={`line-${index}`}><strong>Line item {index + 1} · {source(row.evidence.chunk)}</strong><br />{row.evidence.quote}</p>)}</>
                : view.data.rows.map((row, index) => <p key={index}><strong>Row {index + 1} · {source(row.evidence.chunk)}</strong><br />{row.evidence.quote}</p>)}
            </details>
          </>}
          {busy === "extract" && <p className="extraction-progress" role="status"><Loader2 size={17} className="spin" />Reading the file and checking the result…</p>}
          {error && <p className="extraction-warning" role="alert">{error}</p>}
        </div>
        <div className="extraction-footer">
          {view ? <>
            <button type="button" disabled={!!busy || disabled} onClick={() => {
              const checked = extractionSchema.safeParse(view);
              if (!checked.success) { setError("Check the result size and values before saving."); return; }
              if (onSave(checked.data)) {
                changeOpen(false);
                if (!initial) setResult(null);
              }
            }}><Save size={15} />Save to chat</button>
            <button type="button" disabled={!!busy} onClick={() => void download("json")}><Download size={15} />JSON</button>
            <button type="button" disabled={!!busy} onClick={() => void download("xlsx")}><Download size={15} />Excel</button>
            {!initial && <button type="button" disabled={!!busy} onClick={() => { setResult(null); setError(""); }}>Start over</button>}
          </> : <button type="button" className="extraction-primary" disabled={!!busy} onClick={() => void extract()}><Table2 size={16} />Extract data</button>}
          {busy && <button type="button" onClick={() => { abort.current?.abort(); setBusy(null); setError("Cancelled. A provider request already sent may still use credits."); }}>Cancel</button>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
