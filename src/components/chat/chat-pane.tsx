"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useTheme } from "next-themes";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Feather,
  Globe2,
  Lightbulb,
  Loader2,
  Moon,
  PanelLeft,
  RotateCcw,
  Square,
  Sun,
  X,
  Paperclip,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { conversations } from "@/lib/conversations";
import { MODELS, findModel, type ModelId } from "@/lib/models";
import {
  metadataSchema,
  type ChatMessage,
  type Conversation,
  type ChatConfig,
} from "@/lib/chat-schema";
import { createChatTransport } from "@/lib/chat-transport";
import { copyText, MessageMarkdown } from "./markdown";
import { Brand } from "./brand";
import { ImageMessages } from "./image-messages";
import { useAttachments } from "./use-attachments";
import { DocumentMessages } from "./document-messages";
import { DocumentReading } from "./document-reading";
import { imageResultSchema } from "@/lib/media";
import { ExtractionMessages } from "./extraction-messages";
import { messageContextSize, type Extraction } from "@/lib/extractions";
import { GeneratedFiles } from "./generated-files";
import { createFileInputSchema, fileResultSchema, type FileResult } from "@/lib/generated-files";

const transport = createChatTransport();
const suggestions = [
  {
    icon: Feather,
    title: "Find the right words",
    text: "Draft a thoughtful email, story, or pitch",
    prompt:
      "Help me write a clear, thoughtful email. Ask me who it is for and what I want to say.",
  },
  {
    icon: Code2,
    title: "Build something useful",
    text: "Turn a problem into a working solution",
    prompt:
      "Help me turn an idea into a small coding project. Ask about my idea and experience first.",
  },
  {
    icon: Lightbulb,
    title: "Think a little bigger",
    text: "Explore fresh angles on your next idea",
    prompt:
      "Be my brainstorming partner. Ask me what challenge I am working on, then help me explore new angles.",
  },
  {
    icon: Globe2,
    title: "Make sense of it",
    text: "Break down a topic, one step at a time",
    prompt:
      "Help me understand a complex topic. Ask what I want to learn and what I already know.",
  },
];

function ModelPicker({
  value,
  onChange,
}: {
  value: ModelId;
  onChange: (model: ModelId) => void;
}) {
  const model = findModel(value)!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="model-trigger"
        aria-label={`Select model, current: ${model.name}`}
      >
        <span className={`provider-mark ${model.color}`}>{model.mark}</span>
        <span>{model.name}</span>
        <ChevronDown size={15} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="model-menu" sideOffset={12}>
        <div className="menu-heading">
          CHOOSE YOUR MODEL
          <span>Your next reply keeps this chat’s history.</span>
        </div>
        {MODELS.map((item) => (
          <DropdownMenuItem
            className="model-option"
            key={item.id}
            onClick={() => onChange(item.id)}
          >
            <span className={`provider-mark ${item.color}`}>{item.mark}</span>
            <span className="model-option-copy">
              <strong>{item.name}</strong>
              <small>
                {item.provider} · Vision · {item.description}
              </small>
            </span>
            {item.id === value && <Check size={16} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChatPane({
  conversation,
  config,
  onOpenSidebar,
  onSettings,
}: {
  conversation: Conversation;
  config: ChatConfig | null;
  onOpenSidebar: () => void;
  onSettings: () => void;
}) {
  const { messages, sendMessage, status, error, stop, regenerate, clearError, setMessages } =
    useChat<ChatMessage>({
      id: conversation.id,
      messages: conversation.messages,
      transport,
      messageMetadataSchema: metadataSchema,
      throttle: 50,
      // Persist the completed response even if the last render update was throttled.
      onFinish: ({ messages: completedMessages }) => {
        conversations.saveMessages(conversation.id, completedMessages);
      },
    });
  const [input, setInput] = useState("");
  const [editTarget, setEditTarget] = useState<FileResult | null>(null);
  const uploads = useAttachments(conversation.id);
  const filePicker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [nearBottom, setNearBottom] = useState(true);
  const { resolvedTheme, setTheme } = useTheme();
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const busy = status === "streaming" || status === "submitted" || uploads.uploading;
  function saveExtraction(result: Extraction, messageId?: string) {
    if (busy) return false;
    const part = { type: "data-extraction" as const, data: result };
    const next: ChatMessage[] = messageId
      ? messages.map((message) => message.id === messageId ? { ...message, parts: message.parts.map((existing) => existing.type === "data-extraction" ? part : existing) } : message)
      : [...messages, { id: crypto.randomUUID(), role: "assistant", parts: [part], metadata: { modelId: result.model, demo: result.demo, createdAt: result.createdAt } }];
    // Leave room for the next question instead of saving a result that traps the chat.
    if (next.length >= 100 || next.reduce((total, message) => total + messageContextSize(message), 0) > 56_000 ||
      new TextEncoder().encode(JSON.stringify(next)).length > 112_000) {
      toast.error("This chat has little context space left. Download the extraction instead, or use a new conversation.");
      return false;
    }
    setMessages(next);
    conversations.saveMessages(conversation.id, next);
    toast.success("Extraction saved in this conversation.");
    return true;
  }
  // Keep partial responses when a stream is stopped or the user leaves this chat.
  useEffect(() => {
    conversations.saveMessages(conversation.id, messages);
  }, [conversation.id, messages]);
  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );
  useEffect(() => {
    if (nearBottom && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, status, nearBottom]);
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = "auto";
      textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`;
    }
  }, [input]);
  const addFiles = (files: File[]) => {
    if (busy) return;
    const allowed = files.filter((file) => {
      if (file.type.startsWith("image/")) {
        if (config?.images !== false) return true;
        toast.error("Images are unavailable in this workspace. You can still send text messages.");
      } else {
        if (config?.documents) return true;
        toast.error("Document uploads are not enabled yet. Image and text chat are still available.");
      }
      return false;
    });
    uploads.addFiles(allowed);
  };
  const submit = async () => {
    if ((!input.trim() && !uploads.attachments.length) || busy || config?.enabled === false) return;
    if (uploads.attachments.some((item) => item.isImage) && config?.images === false) {
      toast.error("Remove the image attachments to continue with text chat.");
      return;
    }
    const text = input.trim();
    try {
      const files = await uploads.upload();
      setInput((current) => current.trim() === text ? "" : current); uploads.clear(); clearError(); setNearBottom(true);
      const target = editTarget; setEditTarget(null);
      await sendMessage({ role: "user", parts: [
        ...(text ? [{ type: "text" as const, text }] : []), ...files,
        ...(target ? [{ type: "data-file-edit" as const, data: { documentId: target.documentId } }] : []),
      ] }, { body: { model: conversation.model } });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        toast.error(error instanceof Error ? error.message : "The files could not be uploaded. Please try again.");
    }
  };
  const regenerateResponse = () => {
    clearError();
    void regenerate({ body: { model: conversation.model } });
  };
  const checkFileStatus = async (messageId?: string) => {
    const end = messageId ? messages.findIndex((message) => message.id === messageId) : messages.length;
    const user = messages.slice(0, end).findLast((message) => message.role === "user");
    if (!user || busy) return;
    try {
      const response = await fetch("/api/documents/generated/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: conversation.id, turnId: user.id }) });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      const file = fileResultSchema.safeParse(result.file);
      const input = createFileInputSchema.safeParse(result.input);
      if (!file.success || !input.success) {
        toast.info(result.status === "failed" ? "The file could not be completed. No automatic retry was made." : result.status === "not-started" ? "No file has started saving for this message." : "The file is still being saved or indexed. Check again shortly.");
        return;
      }
      const part = { type: "tool-createFile" as const, toolCallId: `recovered-${file.data.documentId}`, state: "output-available" as const, input: input.data, output: file.data };
      const recovered: ChatMessage = { id: messageId ?? crypto.randomUUID(), role: "assistant", parts: [part] };
      const next = messages.some((message) => message.id === recovered.id)
        ? messages.map((message) => message.id === recovered.id ? { ...message, parts: [...message.parts.filter((existing) => existing.type !== "tool-createFile"), part] } : message)
        : [...messages, recovered];
      setMessages(next); conversations.saveMessages(conversation.id, next);
      clearError(); toast.success("Your completed file was recovered.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not check file status."); }
  };
  const checkImageStatus = async (messageId?: string) => {
    const end = messageId ? messages.findIndex((message) => message.id === messageId) : messages.length;
    const user = messages.slice(0, end).findLast((message) => message.role === "user");
    if (!user) return;
    try {
      const response = await fetch("/api/media/jobs/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: conversation.id, turnId: user.id }) });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      const image = imageResultSchema.safeParse(result.image);
      if (result.status !== "succeeded" || !image.success) {
        toast.info(result.status === "running" ? "The image is still processing. Check again in a moment." : result.status === "uncertain" ? "The provider result is uncertain. No automatic retry will be made." : "No generation started for that message.");
        return;
      }
      const output = image.data;
      const recovered: ChatMessage = { id: messageId ?? crypto.randomUUID(), role: "assistant", parts: [{ type: "tool-createImage", toolCallId: `recovered-${output.assetId}`, state: "output-available", input: { operation: output.operation, prompt: output.prompt, referenceIds: output.parentIds, aspectRatio: output.aspectRatio }, output }] };
      const index = messages.findIndex((message) => message.id === recovered.id);
      setMessages(index >= 0 ? messages.map((message, i) => i === index ? { ...message, parts: [...message.parts.filter((part) => part.type !== "tool-createImage"), ...recovered.parts] } : message) : [...messages, recovered]);
      clearError(); toast.success("Your generated image was recovered.");
    } catch { toast.error("Could not check the image status. Please try again."); }
  };
  return (
    <main className={`chat-main ${dragging ? "is-dragging" : ""}`}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}
    >
      {dragging && <div className="image-drop-overlay" role="status">Drop files to add them to your message</div>}
      <header className="chat-header">
        <div className="header-left">
          <button
            className="icon-button mobile-menu-toggle"
            aria-label="Open conversations"
            onClick={onOpenSidebar}
          >
            <PanelLeft size={20} />
          </button>
          <ModelPicker
            value={conversation.model}
            onChange={(model) => conversations.setModel(conversation.id, model)}
          />
          <span className="header-divider" />
          <span className="header-subtitle">Your space to think</span>
        </div>
        <div className="header-right">
          <button
            className={`connection-badge ${config?.demo ? "demo" : ""}`}
            onClick={onSettings}
          >
            <span />
            {config
              ? config.demo
                ? "Demo mode"
                : config.enabled
                  ? "Connected"
                  : "Setup needed"
              : "Workspace"}
          </button>
          <button
            className="icon-button theme-toggle"
            aria-label="Toggle color theme"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            <Sun className="sun-icon" size={18} />
            <Moon className="moon-icon" size={18} />
          </button>
        </div>
      </header>
      <div
        className={`chat-scroll ${messages.length ? "has-messages" : ""}`}
        ref={scroller}
        onScroll={() => {
          const element = scroller.current;
          if (element)
            setNearBottom(
              element.scrollHeight - element.scrollTop - element.clientHeight <
                140,
            );
        }}
      >
        {messages.length === 0 ? (
          <section className="welcome">
            <div className="welcome-eyebrow">
              <span />TEXT, IMAGES, FILES, ONE CONVERSATION
            </div>
            <Brand />
            <h1>
              Where should we
              <br />
              <span>take your mind today?</span>
            </h1>
            <p>
              A question, a spark, a half-formed idea.
              <br className="mobile-break" /> Let’s make something of it.
            </p>
            <div className="suggestion-grid">
              {suggestions.map(({ icon: Icon, title, text, prompt }) => (
                <button
                  className="suggestion-card"
                  key={title}
                  onClick={() => {
                    setInput(prompt);
                    textarea.current?.focus();
                  }}
                >
                  <div>
                    <span className="suggestion-icon">
                      <Icon size={19} strokeWidth={1.6} />
                    </span>
                    <ArrowUpRight size={15} className="suggestion-arrow" />
                  </div>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </button>
              ))}
            </div>
            <div className="provider-caption">
              <span className="mini-provider">O</span>
              <span className="mini-provider">A</span>
              <span className="mini-provider">G</span>
              <span>Different strengths. Endless possibilities.</span>
            </div>
          </section>
        ) : (
          <div
            className="message-list"
            role="log"
            aria-label="Conversation messages"
            aria-busy={busy}
          >
            {messages.map((message) => {
              const text = message.parts
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("");
              const model = message.metadata
                ? findModel(message.metadata.modelId)
                : undefined;
              return (
                <article className={`message ${message.role}`} key={message.id}>
                  {message.role === "assistant" && (
                    <div className="message-byline">
                      <Brand small />
                      <strong>Numbase</strong>
                      <span>{model?.name ?? "Assistant"}</span>
                      {message.metadata?.demo && <small>Demo</small>}
                    </div>
                  )}
                  {message.role === "assistant" && <MessageMarkdown text={text} />}
                  <DocumentMessages message={message} conversationId={conversation.id} busy={busy} allowExtraction={config?.extraction ?? false} allowSummaries={config?.summaries ?? false} onExtract={saveExtraction} />
                  <DocumentReading message={message} />
                  <ExtractionMessages message={message} conversationId={conversation.id} busy={busy} onSave={saveExtraction} />
                  <GeneratedFiles message={message} busy={busy} onCheck={() => void checkFileStatus(message.id)} onEdit={(file) => {
                    setEditTarget(file);
                    setInput(`Edit the file ${JSON.stringify(file.filename)} (version ${file.version}) as a new copy: `);
                    textarea.current?.focus();
                  }} />
                  <ImageMessages message={message} busy={busy} onCheck={() => void checkImageStatus(message.id)} onAction={(action, image) => {
                    setEditTarget(null);
                    uploads.addReference({ type: "file", url: image.url, mediaType: "image/png", filename: "Generated reference" });
                    setInput(action === "edit" ? "Edit this image: " : action === "variation" ? "Create a new variation of this image, keeping its main subject and style." : "Regenerate this image using its original prompt and reference images.");
                    textarea.current?.focus();
                  }} />
                  {message.role === "user" && text && <div className="user-bubble">{text}</div>}
                  {message.role === "assistant" && text && (
                    <div className="message-actions">
                      <button
                        className="icon-button"
                        aria-label="Copy response"
                        onClick={() => copyText(text)}
                      >
                        <Copy size={15} />
                      </button>
                      {message.id === messages.at(-1)?.id && !busy && (
                        <button
                          className="icon-button"
                          aria-label="Regenerate response"
                          onClick={regenerateResponse}
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {!busy && !error && messages.at(-1)?.role === "user" && (
              <div className="image-tool-error" role="status">
                This message has no completed reply yet.
                <button type="button" onClick={regenerateResponse}>Retry last reply</button>
                <button type="button" onClick={() => void checkImageStatus()}>Check image status</button>
                {config?.files && <button type="button" onClick={() => void checkFileStatus()}>Check file status</button>}
              </div>
            )}
            {status === "submitted" && (
              <div className="thinking" role="status">
                <Brand small />
                <span>Working on your request…</span>
                <Loader2 size={16} className="spin" />
              </div>
            )}
          </div>
        )}
      </div>
      <div className="composer-area">
        {!nearBottom && messages.length > 0 && (
          <button
            className="jump-button"
            aria-label="Jump to latest message"
            onClick={() => {
              setNearBottom(true);
              scroller.current?.scrollTo({
                top: scroller.current.scrollHeight,
                behavior: "smooth",
              });
            }}
          >
            <ArrowDown size={17} />
          </button>
        )}
        {error && (
          <div className="chat-error" role="alert">
            <span>
              {error.message || "Something went wrong. Please try again."}
            </span>
            <button onClick={regenerateResponse}>Retry</button>
            <button onClick={() => void checkImageStatus()}>Check image status</button>
            {config?.files && <button onClick={() => void checkFileStatus()}>Check file status</button>}
            <button aria-label="Dismiss error" onClick={clearError}>
              <X size={15} />
            </button>
          </div>
        )}
        {config && !config.enabled && (
          <div className="chat-error">
            Live chat needs server configuration.{" "}
            <button onClick={onSettings}>View details</button>
          </div>
        )}
        <form
          className={`composer ${busy ? "is-streaming" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input ref={filePicker} type="file" accept="image/jpeg,image/png,image/webp,.pdf,.docx,.xlsx,.csv,.txt,.md,.markdown,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.java,.c,.h,.cpp,.hpp,.cs,.go,.rs,.rb,.php,.swift,.kt,.sql,.html,.css,.scss,.json,.yaml,.yml,.xml,.sh,.ps1,.r,.lua,.toml,.ini,.log" multiple hidden onChange={(event) => {
            addFiles(Array.from(event.target.files ?? [])); event.target.value = "";
          }} />
          {editTarget && <div className="file-edit-target" role="status"><FileText size={16} /><span>Editing {editTarget.filename} · Version {editTarget.version}</span><button type="button" disabled={busy} onClick={() => setEditTarget(null)} aria-label="Cancel file edit"><X size={15} /></button></div>}
          {uploads.attachments.length > 0 && <div className="attachment-tray" aria-label="Files ready to send">{uploads.attachments.map((item) => <div className={item.isImage ? "draft-image" : "draft-document"} key={item.id} title={item.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {item.isImage ? <img src={item.preview} alt={item.name} /> : <><FileText size={24} /><span>{item.name}</span></>}
            <button className="icon-button" type="button" disabled={uploads.uploading} onClick={() => uploads.remove(item.id)} aria-label={`Remove ${item.name}`}><X size={14} /></button>
          </div>)}</div>}
          {uploads.uploading && <div className="upload-progress" role="status"><Loader2 size={15} className="spin" />{uploads.progress || "Preparing your message…"}<button type="button" onClick={uploads.cancel}>Cancel</button></div>}
          <label htmlFor="composer" className="sr-only">
            Message Numbase AI
          </label>
          <textarea
            id="composer"
            ref={textarea}
            placeholder="Ask a question, attach a file, or describe what to create."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file").flatMap((item) => item.getAsFile() ?? []);
              if (files.length) { event.preventDefault(); addFiles(files); }
            }}
            maxLength={16_000}
            rows={1}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="composer-toolbar">
            <button type="button" className="icon-button attach-button" aria-label="Attach files" title={config?.documents ? "Attach up to 4 files · Documents up to 20 MB · Images up to 5 MB" : "Attach up to 4 images · JPEG, PNG, WebP · 5 MB each"} disabled={busy || (config?.images === false && !config?.documents)} onClick={() => filePicker.current?.click()}><Paperclip size={19} /></button>
            <div className="composer-model">
              <ModelPicker value={conversation.model} onChange={(model) => conversations.setModel(conversation.id, model)} />
            </div>
            <div className="composer-send">
              <span className="enter-hint">
                {busy ? "Creating a response…" : "Shift + Enter for a new line"}
              </span>
              {busy ? (
                <button
                  className="send-button"
                  type="button"
                  aria-label="Stop response"
                  onClick={() => {
                    uploads.cancel(); void stop();
                  }}
                >
                  <Square size={16} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  aria-label="Send message"
                  disabled={(!input.trim() && !uploads.attachments.length) || config?.enabled === false}
                >
                  <ArrowUp size={20} />
                </button>
              )}
            </div>
          </div>
        </form>
        <p className="composer-disclaimer">
          {config?.demo
            ? "Demo mode uses sample responses. Connect OpenRouter for live answers."
            : "Files, images, and messages may be sent to the selected AI providers. Double-check important details."}
        </p>
      </div>
    </main>
  );
}
