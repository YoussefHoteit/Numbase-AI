"use client";
import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MessageMarkdown } from "./markdown";

type State = { status: "not-started" | "queued" | "processing" | "ready" | "failed" | "cancelled"; completedSections?: number; totalSections?: number; result?: string; error?: string };
export function DocumentSummary({ documentId, conversationId, filename, disabled }: { documentId: string; conversationId: string; filename: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: "not-started" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/documents/${documentId}/summary?conversationId=${encodeURIComponent(conversationId)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(await response.text());
        const next: State = await response.json();
        if (controller.signal.aborted) return;
        setState(next);
        if (["queued", "processing"].includes(next.status)) timer = setTimeout(poll, 5000);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Summary status unavailable."); }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [open, documentId, conversationId, refresh]);
  async function action(action: "start" | "cancel") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/documents/${documentId}/summary`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, action }) });
      if (!response.ok) throw new Error(await response.text());
      setState(await response.json()); setRefresh((value) => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : "Summary request failed."); }
    finally { setBusy(false); }
  }
  const running = ["queued", "processing"].includes(state.status);
  return <>
    <button type="button" disabled={disabled} onClick={() => setOpen(true)}><FileText size={14} />Complete summary</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="extraction-panel">
      <div className="extraction-heading"><DialogTitle>Complete document summary</DialogTitle><DialogDescription>{filename}</DialogDescription></div>
      <div className="extraction-body">
        <p className="extraction-note">Reviews every indexed section in background steps, then combines the results. Gemini 2.5 Flash-Lite · Maximum $0.50 per job; usually less. One new job per browser/day and two globally/day. Opening a completed result is free.</p>
        {running && <p role="status" className="extraction-progress"><Loader2 size={18} className="spin" />{state.completedSections ?? 0}/{state.totalSections ?? "…"} sections reviewed{state.completedSections === state.totalSections ? " · Combining the summary" : ""}. You can close this panel and return later.</p>}
        {state.result && <><p className="extraction-note">All {state.totalSections} indexed sections were reviewed. Summaries condense details; parser omissions and model mistakes can still occur.</p><MessageMarkdown text={state.result} /></>}
        {(error || state.error) && <p className="extraction-warning" role="alert">{error || state.error}</p>}
        {state.status === "cancelled" && <p>Summary cancelled. An already running provider request may still use credits.</p>}
      </div>
      <div className="extraction-footer">{running ? <button disabled={busy} onClick={() => void action("cancel")}>Cancel summary</button> : state.status !== "ready" && <button disabled={busy} onClick={() => void action("start")}>{busy ? "Starting…" : state.status === "not-started" ? "Start complete summary" : "Start a new summary"}</button>}</div>
    </DialogContent></Dialog>
  </>;
}
