"use client";
import { useEffect, useState } from "react";
import { Files, RotateCcw, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type FileItem = { id: string; filename: string; conversationId: string; status: string; removedAt?: number; purgePendingAt?: number; purgeAfter?: number };
type FilesState = { files: FileItem[]; active: number; capacity: number };
export function FileManager() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FilesState | null>(null);
  const [checkedAt, setCheckedAt] = useState(0);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const [deleting, setDeleting] = useState<FileItem | null>(null); const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/documents/manage", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(await response.text()); return response.json();
    }).then((next) => { if (!controller.signal.aborted) { setState(next); setCheckedAt(Date.now()); } }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [open, refresh]);
  async function change(file: FileItem, purge = false) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/documents/manage", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(purge ? { documentId: file.id, conversationId: file.conversationId, action: "purge", confirmation } : { documentId: file.id, conversationId: file.conversationId, removed: !file.removedAt }) });
      if (!response.ok) throw new Error(await response.text());
      setDeleting(null); setConfirmation(""); setRefresh((value) => value + 1);
      window.dispatchEvent(new Event("numbase-files-changed"));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not update this file."); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="manage-files-button" onClick={() => { setError(""); setDeleting(null); setOpen(true); }}><Files size={16} />Files</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="extraction-panel">
      <div className="extraction-heading"><DialogTitle>{deleting ? "Delete file permanently?" : "Your files"}</DialogTitle><DialogDescription>{deleting ? deleting.filename : state ? state.active + "/" + state.capacity + " active files in this browser" : "Loading files…"}</DialogDescription></div>
      <div className="extraction-body">
        {error && <p role="alert" className="extraction-warning">{error}</p>}
        {deleting ? <div className="file-delete-confirmation">
          <p>This permanently deletes the stored file, its server-side draft and search index. It cannot be undone. Earlier chat messages and downloaded copies remain; the stored file cannot be restored.</p>
          <label htmlFor="delete-filename">Type the filename to confirm</label>
          <input id="delete-filename" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy} />
        </div> : <>
          <p className="extraction-note">Remove files to free active slots. Removed files can be restored. To reclaim shared storage, permanently delete a removed file after reviewing the confirmation. Daily and chat limits do not reset.</p>
          {state?.files.length === 0 && <p>No documents uploaded in this browser yet.</p>}
          <ul className="managed-files">{state?.files.map((file) => <li key={file.id}>
            <div><strong>{file.filename}</strong><small>{file.purgePendingAt ? "Deletion awaiting cleanup" : file.removedAt ? "Removed · Restorable" : file.status}</small>
              {!!file.removedAt && (file.purgeAfter ?? Infinity) > checkedAt && <small>Permanent deletion is available after {new Date(file.purgeAfter!).toLocaleString()}; earlier requests and upload tickets must settle first.</small>}</div>
            <div className="managed-file-actions">
              {!file.purgePendingAt && <button type="button" disabled={busy} onClick={() => void change(file)} aria-label={(file.removedAt ? "Restore " : "Remove ") + file.filename}>{file.removedAt ? <RotateCcw size={15} /> : <Trash2 size={15} />}{file.removedAt ? "Restore" : "Remove"}</button>}
              {!!file.removedAt && <button type="button" disabled={busy || (file.purgeAfter ?? Infinity) > checkedAt} onClick={() => { setDeleting(file); setConfirmation(""); setError(""); }} aria-label={"Permanently delete " + file.filename}>{file.purgePendingAt ? "Retry deletion" : "Delete permanently"}</button>}
            </div>
          </li>)}</ul>
        </>}
      </div>
      {deleting && <div className="extraction-footer"><button type="button" disabled={busy} onClick={() => { setDeleting(null); setConfirmation(""); setError(""); }}>Cancel</button><button type="button" className="destructive-action" disabled={busy || confirmation !== deleting.filename} onClick={() => void change(deleting, true)}>{busy ? "Deleting…" : "Delete permanently"}</button></div>}
    </DialogContent></Dialog>
  </>;
}
