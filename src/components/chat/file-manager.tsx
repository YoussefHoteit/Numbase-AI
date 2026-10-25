"use client";
import { useEffect, useState } from "react";
import { Files, RotateCcw, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type FileItem = { id: string; filename: string; conversationId: string; status: string; removedAt?: number };
type FilesState = { files: FileItem[]; active: number; capacity: number };
export function FileManager() {
  const [open, setOpen] = useState(false); const [state, setState] = useState<FilesState | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/documents/manage", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(await response.text()); return response.json();
    }).then(setState).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [open, refresh]);
  async function change(file: FileItem) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/documents/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: file.id, conversationId: file.conversationId, removed: !file.removedAt }) });
      if (!response.ok) throw new Error(await response.text());
      setRefresh((value) => value + 1); window.dispatchEvent(new Event("numbase-files-changed"));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not update this file."); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="manage-files-button" onClick={() => { setError(""); setOpen(true); }}><Files size={16} />Files</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="extraction-panel">
      <div className="extraction-heading"><DialogTitle>Your files</DialogTitle><DialogDescription>{state ? `${state.active}/${state.capacity} active files in this browser` : "Loading files…"}</DialogDescription></div>
      <div className="extraction-body"><p className="extraction-note">Remove files to free active-file slots. Removed originals stay private and can be restored; removal does not erase chat messages or reset daily upload limits. Removed files still count toward the shared storage limit.</p>
        {error && <p role="alert" className="extraction-warning">{error}</p>}
        {state?.files.length === 0 && <p>No documents uploaded in this browser yet.</p>}
        <ul className="managed-files">{state?.files.map((file) => <li key={file.id}><div><strong>{file.filename}</strong><small>{file.removedAt ? "Removed · Restorable" : file.status}</small></div><button type="button" disabled={busy} onClick={() => void change(file)} aria-label={`${file.removedAt ? "Restore" : "Remove"} ${file.filename}`}>{file.removedAt ? <RotateCcw size={15} /> : <Trash2 size={15} />}{file.removedAt ? "Restore" : "Remove"}</button></li>)}</ul>
      </div>
    </DialogContent></Dialog>
  </>;
}
