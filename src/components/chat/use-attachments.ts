"use client";
import { useEffect, useRef, useState } from "react";
import type { FileUIPart } from "ai";
import { toast } from "sonner";
import { attachmentError, MAX_ATTACHMENTS } from "@/lib/media";
import { ensureMediaSession, uploadImage } from "@/lib/image-upload";
import { documentAttachmentError } from "@/lib/documents";
import { uploadDocument } from "@/lib/document-upload";

export type Attachment = { id: string; name: string; preview: string; isImage: boolean; file?: File; uploaded?: FileUIPart };
export function useAttachments(conversationId: string) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const urls = useRef(new Set<string>());
  const abort = useRef<AbortController | null>(null);
  const active = useRef(false);
  useEffect(() => {
    const allocated = urls.current;
    return () => { abort.current?.abort(); for (const url of allocated) URL.revokeObjectURL(url); };
  }, []);
  function addFiles(files: File[]) {
    if (active.current) return;
    const valid = files.filter((file) => {
      const error = file.type.startsWith("image/") ? attachmentError(file) : documentAttachmentError(file);
      if (error) toast.error(`${file.name}: ${error}`);
      return !error;
    });
    const slots = MAX_ATTACHMENTS - attachments.length;
    if (valid.length > slots) toast.error(`Attach up to ${MAX_ATTACHMENTS} files per message.`);
    const added = valid.slice(0, slots).map((file) => {
      const isImage = file.type.startsWith("image/");
      const preview = isImage ? URL.createObjectURL(file) : "";
      if (preview) urls.current.add(preview);
      return { id: crypto.randomUUID(), name: file.name, file, preview, isImage };
    });
    setAttachments((previous) => [...previous, ...added].slice(0, MAX_ATTACHMENTS));
  }
  function remove(id: string) {
    const item = attachments.find((item) => item.id === id);
    if (item && urls.current.delete(item.preview)) URL.revokeObjectURL(item.preview);
    setAttachments((previous) => previous.filter((item) => item.id !== id));
  }
  function clear() {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear(); setAttachments([]); setProgress("");
  }
  function addReference(part: FileUIPart) {
    if (active.current) return;
    // Image actions target one specific version; prior versions remain in history.
    clear();
    setAttachments([{ id: crypto.randomUUID(), name: "Reference image", preview: part.url, uploaded: part, isImage: true }]);
  }
  async function upload(): Promise<FileUIPart[]> {
    if (active.current) throw new Error("Please wait for the current upload.");
    // Text-only messages must not depend on image storage or its session cookie.
    if (!attachments.length) return [];
    active.current = true; setUploading(true);
    const controller = new AbortController(); abort.current = controller;
    try {
      if (attachments.some((item) => item.isImage && !item.uploaded)) await ensureMediaSession(controller.signal);
      const parts: FileUIPart[] = [];
      // Sequential uploads reuse one session and keep successfully uploaded files on retry.
      for (const [index, item] of attachments.entries()) {
        setProgress(`Uploading file ${index + 1} of ${attachments.length}…`);
        const part = item.uploaded ?? await (item.isImage ? uploadImage : uploadDocument)(item.file!, conversationId, controller.signal);
        parts.push(part);
        setAttachments((current) => current.map((entry) => entry.id === item.id ? { ...entry, uploaded: part } : entry));
      }
      return parts;
    } finally { active.current = false; setUploading(false); setProgress(""); }
  }
  return { attachments, uploading, progress, addFiles, remove, clear, addReference, upload, cancel: () => abort.current?.abort() };
}
