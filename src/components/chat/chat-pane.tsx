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
  Sparkles,
  Square,
  Sun,
  X,
  Paperclip,
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
import { useImageAttachments } from "./use-image-attachments";
import { imageResultSchema } from "@/lib/media";

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
  const images = useImageAttachments(conversation.id);
  const filePicker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [nearBottom, setNearBottom] = useState(true);
  const { resolvedTheme, setTheme } = useTheme();
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const busy = status === "streaming" || status === "submitted" || images.uploading;
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
  const addImages = (files: File[]) => {
    if (busy) return;
    if (config?.images === false) {
      toast.error("Images are unavailable in this workspace. You can still send text messages.");
      return;
    }
    images.addFiles(files);
  };
  const submit = async () => {
    if ((!input.trim() && !images.attachments.length) || busy || config?.enabled === false) return;
    if (images.attachments.length && config?.images === false) {
      toast.error("Remove the image attachments to continue with text chat.");
      return;
    }
    const text = input.trim();
    try {
      const files = await images.upload();
      setInput((current) => current.trim() === text ? "" : current); images.clear(); clearError(); setNearBottom(true);
      await sendMessage({ text, files }, { body: { model: conversation.model } });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        toast.error(error instanceof Error ? error.message : "The images could not be uploaded. Please try again.");
    }
  };
  const regenerateResponse = () => {
    clearError();
    void regenerate({ body: { model: conversation.model } });
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
      onDrop={(event) => { event.preventDefault(); setDragging(false); addImages(Array.from(event.dataTransfer.files)); }}
    >
      {dragging && <div className="image-drop-overlay" role="status">Drop images to add them to your message</div>}
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
              <span />TEXT, IMAGES, ONE CONVERSATION
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
                  {message.role === "user" ? (
                    text && <div className="user-bubble">{text}</div>
                  ) : (
                    <MessageMarkdown text={text} />
                  )}
                  <ImageMessages message={message} busy={busy} onCheck={() => void checkImageStatus(message.id)} onAction={(action, image) => {
                    images.addReference({ type: "file", url: image.url, mediaType: "image/png", filename: "Generated reference" });
                    setInput(action === "edit" ? "Edit this image: " : action === "variation" ? "Create a new variation of this image, keeping its main subject and style." : "Regenerate this image using its original prompt and reference images.");
                    textarea.current?.focus();
                  }} />
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
          <input ref={filePicker} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => {
            addImages(Array.from(event.target.files ?? [])); event.target.value = "";
          }} />
          {images.attachments.length > 0 && <div className="attachment-tray" aria-label="Images ready to send">{images.attachments.map((item) => <div className="draft-image" key={item.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.preview} alt={item.name} />
            <span title={item.name}>{item.name}</span>
            <button className="icon-button" type="button" disabled={images.uploading} onClick={() => images.remove(item.id)} aria-label={`Remove ${item.name}`}><X size={14} /></button>
          </div>)}</div>}
          {images.uploading && <div className="upload-progress" role="status"><Loader2 size={15} className="spin" />{images.progress || "Preparing your message…"}<button type="button" onClick={images.cancel}>Cancel</button></div>}
          <label htmlFor="composer" className="sr-only">
            Message Numbase AI
          </label>
          <textarea
            id="composer"
            ref={textarea}
            placeholder="Ask a question, add an image, or describe what to create."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file").flatMap((item) => item.getAsFile() ?? []);
              if (files.length) { event.preventDefault(); addImages(files); }
            }}
            maxLength={16_000}
            rows={2}
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
            <button type="button" className="icon-button attach-button" aria-label="Attach images" title={config?.images === false ? "Images are unavailable; text chat is available" : "Attach up to 4 images · JPEG, PNG, WebP · 5 MB each"} disabled={busy || config?.images === false} onClick={() => filePicker.current?.click()}><Paperclip size={19} /></button>
            <span className="composer-model">
              <Sparkles size={14} />
              <span>{findModel(conversation.model)?.name}</span>
            </span>
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
                    images.cancel(); void stop();
                  }}
                >
                  <Square size={16} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  aria-label="Send message"
                  disabled={(!input.trim() && !images.attachments.length) || config?.enabled === false}
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
            : "Images and messages go to the selected AI providers. Double-check important details."}
        </p>
      </div>
    </main>
  );
}
