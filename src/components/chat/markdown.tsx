"use client";
import { useRef, type ComponentPropsWithoutRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy } from "lucide-react";
import { toast } from "sonner";
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success("Copied to clipboard"); }
  catch { toast.error("Could not copy. Select the text to copy it manually."); }
}
function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  return <div className="code-block"><div className="code-toolbar"><span>Code</span><button type="button" onClick={() => copyText(ref.current?.textContent ?? "")} aria-label="Copy code"><Copy size={14} /> Copy</button></div><pre {...props} ref={ref}>{children}</pre></div>;
}
export function MessageMarkdown({ text }: { text: string }) {
  return <div className="message-markdown"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ alt }) => <span className="muted">[Image: {alt || "external image"}]</span>,
    table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
  }}>{text}</Markdown></div>;
}
