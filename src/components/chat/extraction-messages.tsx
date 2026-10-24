"use client";
import { Table2 } from "lucide-react";
import type { ChatMessage } from "@/lib/chat-schema";
import type { Extraction } from "@/lib/extractions";
import { ExtractionPanel } from "./extraction-panel";

export function ExtractionMessages({ message, conversationId, busy, onSave }: {
  message: ChatMessage; conversationId: string; busy: boolean; onSave: (result: Extraction, messageId?: string) => boolean;
}) {
  return message.parts.flatMap((part, index) => part.type === "data-extraction" ? [
    <div className="extraction-result-card" key={index}>
      <div><Table2 size={20} /><strong>{part.data.kind === "invoice" ? "Invoice fields" : "Extracted table"}</strong></div>
      <p>{part.data.filename}</p><small>{part.data.edited ? "Includes your edits · " : ""}{part.data.kind === "table" ? `${part.data.data.rows.length} ${part.data.data.rows.length === 1 ? "row" : "rows"}` : `${Object.values(part.data.data.fields).filter((field) => field.value !== null).length} fields found`}{part.data.data.truncated ? " · Some data omitted" : ""}</small>
      <ExtractionPanel documentId={part.data.documentId} conversationId={conversationId} filename={part.data.filename} initial={part.data} disabled={busy} onSave={(result) => onSave(result, message.id)} />
    </div>,
  ] : []);
}
