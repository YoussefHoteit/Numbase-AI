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
} from "lucide-react";
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
                {item.provider} · {item.description}
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
  const { messages, sendMessage, status, error, stop, regenerate, clearError } =
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
  const [nearBottom, setNearBottom] = useState(true);
  const { resolvedTheme, setTheme } = useTheme();
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const busy = status === "streaming" || status === "submitted";
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
  const submit = () => {
    if (!input.trim() || busy || config?.enabled === false) return;
    const text = input.trim();
    setInput("");
    clearError();
    setNearBottom(true);
    void sendMessage({ text }, { body: { model: conversation.model } });
  };
  const regenerateResponse = () => {
    clearError();
    void regenerate({ body: { model: conversation.model } });
  };
  return (
    <main className="chat-main">
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
              <span />A WORLD OF IDEAS, ONE CONVERSATION
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
                    <div className="user-bubble">{text}</div>
                  ) : (
                    <MessageMarkdown text={text} />
                  )}
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
            {status === "submitted" && (
              <div className="thinking" role="status">
                <Brand small />
                <span>Making room for an answer</span>
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
            submit();
          }}
        >
          <label htmlFor="composer" className="sr-only">
            Message Numbase AI
          </label>
          <textarea
            id="composer"
            ref={textarea}
            placeholder="Ask anything. Start somewhere."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={16_000}
            rows={2}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-toolbar">
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
                    void stop();
                  }}
                >
                  <Square size={16} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  aria-label="Send message"
                  disabled={!input.trim() || config?.enabled === false}
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
            : "A little perspective goes a long way. Always double-check important details."}
        </p>
      </div>
    </main>
  );
}
