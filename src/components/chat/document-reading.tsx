"use client";

import { FileSearch, Loader2 } from "lucide-react";
import type { ChatMessage } from "@/lib/chat-schema";
import { documentReadResultSchema } from "@/lib/document-reading";

export function DocumentReading({ message }: { message: ChatMessage }) {
  return message.parts.flatMap((part, index) => {
    if (part.type !== "tool-readDocument") return [];
    if (part.state === "output-error") return [<p key={index} className="document-read-status" role="alert">Could not read the requested sections. {part.errorText}</p>];
    if (part.state !== "output-available") return [<p key={index} className="document-read-status" role="status"><Loader2 size={14} className="spin" />Reading document sections…</p>];
    const parsed = documentReadResultSchema.safeParse(part.output);
    if (!parsed.success) return [];
    const result = parsed.data;
    return [<details className="document-read-status" key={index}>
      <summary><FileSearch size={14} />{result.filename} · {result.coverage.includedSections}/{result.coverage.totalSections} sections · {result.coverage.complete ? "Complete indexed text" : result.operation === "overview" ? "Sampled overview" : "Selected range"}</summary>
      <p>{result.note}</p>
      <ul>{result.sections.map((section) => <li key={section.section}>Section {section.section} · {section.location}{section.shortened ? " · Excerpt" : ""}</li>)}</ul>
    </details>];
  });
}
