"use client";

import { useEffect, useState } from "react";
import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import type { ChatMessage } from "@/lib/chat-schema";
import { documentIdFromUrl, type DocumentStatus } from "@/lib/documents";

type FileState = { status: DocumentStatus; indexed: number; chunkCount: number; warnings: string[]; error?: string };
function DocumentCard({ url, filename }: { url: string; filename: string }) {
  const [state, setState] = useState<FileState | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    async function refresh() {
      try {
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error(await response.text());
        const next: FileState = await response.json();
        if (abort.signal.aborted) return;
        setState(next); setError("");
        if (["pending", "queued", "processing"].includes(next.status) && ++polls < 120) timer = setTimeout(refresh, 2500);
      } catch (error) {
        if (!abort.signal.aborted) setError(error instanceof Error ? error.message : "File status is unavailable.");
      }
    }
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [url, retry]);
  const processing = state && ["pending", "queued", "processing"].includes(state.status);
  return <div className="document-card">
    <div className="document-card-heading"><FileText size={23} /><div><strong title={filename}>{filename}</strong><small>
      {error ? "File unavailable" : state?.status === "ready" ? "Ready to discuss" : state?.status === "failed" ? "Processing failed" : processing ? `Preparing file${state.chunkCount ? ` · ${state.indexed}/${state.chunkCount} sections` : "…"}` : "Checking file…"}
    </small></div>{processing && <Loader2 size={17} className="spin" />}</div>
    {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
    {state?.warnings.map((warning) => <p className="document-warning" key={warning}>{warning}</p>)}
    <div className="document-card-actions"><button type="button" aria-label={`Refresh ${filename}`} onClick={() => setRetry((value) => value + 1)}><RefreshCw size={14} />Check status</button>
      {state && <a href={`${url}?download=1`} download><Download size={14} />Original</a>}
    </div>
  </div>;
}
export function DocumentMessages({ message }: { message: ChatMessage }) {
  return <div className="message-documents">{message.parts.flatMap((part) => part.type === "file" && documentIdFromUrl(part.url)
    ? [<DocumentCard key={part.url} url={part.url} filename={part.filename ?? "Attached document"} />] : [])}</div>;
}
