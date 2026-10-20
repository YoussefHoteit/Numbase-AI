"use client";
import { useState } from "react";
import { Download, ImagePlus, Loader2, Pencil, RotateCcw, X } from "lucide-react";
import type { ChatMessage } from "@/lib/chat-schema";
import { imageResultSchema, type ImageResult } from "@/lib/media";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

function ChatImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  if (failed) return <p className="image-unavailable" role="status">This image is unavailable. Your text history is still saved. Upload the image again to continue.</p>;
  return <>
    <button type="button" className="chat-image-preview" onClick={() => setOpen(true)} aria-label={`Enlarge ${alt}`}>
      {/* Private session routes refresh storage links on every view. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} />
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="image-lightbox" showCloseButton={false}>
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        <button className="icon-button image-close" aria-label="Close image preview" onClick={() => setOpen(false)}><X size={20} /></button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt} />
      </DialogContent>
    </Dialog>
  </>;
}
export function ImageMessages({ message, busy, onAction, onCheck }: {
  message: ChatMessage; busy: boolean;
  onAction: (action: "edit" | "variation" | "regenerate", image: ImageResult) => void;
  onCheck: () => void;
}) {
  return <div className="message-images">{message.parts.map((part, index) => {
    if (part.type === "file") return <figure className="image-card" key={index}><ChatImage url={part.url} alt={part.filename ?? "Attached image"} /><figcaption>{part.filename ?? "Attached image"}</figcaption></figure>;
    if (part.type !== "tool-createImage") return null;
    if (part.state === "output-error") return <div key={index} className="image-tool-error" role="alert">{part.errorText || "The image could not be generated. No automatic retry was made."}<button type="button" disabled={busy} onClick={onCheck}>Check status</button></div>;
    if (part.state !== "output-available") return <div key={index} className="image-progress" role="status">{busy && <Loader2 size={18} className="spin" />}{busy ? "Creating your image… This can take a minute." : <>This image request was interrupted.<button type="button" onClick={onCheck}>Check status</button></>}</div>;
    const parsed = imageResultSchema.safeParse(part.output);
    if (!parsed.success) return null;
    const image = parsed.data;
    return <figure className="image-card generated-image" key={index}>
      <ChatImage url={image.url} alt={image.prompt} />
      <figcaption>Generated image · Gemini 3.1 Flash Image</figcaption>
      <div className="image-actions">
        <a href={`${image.url}?download=1`} download><Download size={14} />Download</a>
        <button type="button" disabled={busy} onClick={() => onAction("edit", image)}><Pencil size={14} />Edit</button>
        <button type="button" disabled={busy} onClick={() => onAction("variation", image)}><ImagePlus size={14} />Variation</button>
        <button type="button" disabled={busy} onClick={() => onAction("regenerate", image)}><RotateCcw size={14} />Regenerate</button>
      </div>
      <details className="image-details"><summary>Image details</summary><p>{image.prompt}</p><small>{image.aspectRatio} · {image.operation}{image.parentIds.length > 0 ? ` · ${image.parentIds.length} reference image(s)` : ""}</small></details>
    </figure>;
  })}</div>;
}
