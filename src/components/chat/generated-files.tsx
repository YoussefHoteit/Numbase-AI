"use client";

import { Download, FileText, Loader2, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChatMessage } from "@/lib/chat-schema";
import { fileResultSchema, type FileResult } from "@/lib/generated-files";

function CompletedFile({ file, busy, onEdit }: { file: FileResult; busy: boolean; onEdit: (file: FileResult) => void }) {
  const [removed, setRemoved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { void fetch(file.url, { signal: controller.signal }).then(async (response) => {
      if (response.ok) setRemoved((await response.json()).status === "removed");
    }).catch(() => {}); };
    refresh(); window.addEventListener("numbase-files-changed", refresh);
    return () => { controller.abort(); window.removeEventListener("numbase-files-changed", refresh); };
  }, [file.url]);
  return <div className="generated-file-card">
    <div className="generated-file-heading"><FileText size={26} /><div><strong title={file.filename}>{file.filename}</strong><small>{file.format === "code" ? "Code" : file.format.toUpperCase()} · Version {file.version} · {Math.ceil(file.size / 1024)} KB</small></div></div>
    <p>{removed ? "Removed from the workspace. Restore in Files to download or edit." : file.parentId ? "A separate edited copy. The source file is unchanged." : "Created in this conversation. Review before using."}</p>
    {!removed && <div className="generated-file-actions"><a href={`${file.url}?download=1`} download><Download size={15} />Download</a><button type="button" disabled={busy} onClick={() => onEdit(file)}><Pencil size={15} />Edit a copy</button></div>}
  </div>;
}

export function GeneratedFiles({ message, busy, onEdit, onCheck }: {
  message: ChatMessage; busy: boolean; onEdit: (file: FileResult) => void; onCheck: () => void;
}) {
  return <div className="generated-files">{message.parts.flatMap((part, index) => {
    if (part.type !== "tool-createFile") return [];
    const parsed = part.state === "output-available" ? fileResultSchema.safeParse(part.output) : null;
    if (parsed?.success) {
      const file = parsed.data;
      return [<CompletedFile key={part.toolCallId} file={file} busy={busy} onEdit={onEdit} />];
    }
    const failed = part.state === "output-error";
    return [<div className="generated-file-card" key={part.toolCallId || index} role="status">
      <div className="generated-file-heading">{busy && !failed ? <Loader2 size={22} className="spin" /> : <FileText size={22} />}<strong>{failed ? "File not completed" : busy ? "Preparing your file…" : "File request interrupted"}</strong></div>
      <p>{failed ? part.errorText : "Your conversation is saved. Check for a completed file before starting another request."}</p>
      {!busy && <button className="generated-file-check" type="button" onClick={onCheck}><RefreshCw size={15} />Check file status</button>}
    </div>];
  })}</div>;
}
