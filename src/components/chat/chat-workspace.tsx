"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useTheme } from "next-themes";
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, Code2, Copy, Feather, Globe2, Lightbulb, Loader2, MessageSquare, Moon, MoreHorizontal, PanelLeft, Pencil, Plus, RotateCcw, Search, SlidersHorizontal, Sparkles, Square, Sun, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { conversations } from "@/lib/conversations";
import { MODELS, findModel, type ModelId } from "@/lib/models";
import { metadataSchema, type ChatMessage, type Conversation } from "@/lib/chat-schema";
import { copyText, MessageMarkdown } from "./markdown";

const transport = new DefaultChatTransport<ChatMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages, body, id }) => ({ body: {
    ...body, id,
    messages: messages.map((message) => ({ ...message, parts: message.parts.filter((part) => part.type === "text") }))
      .filter((message) => message.parts.length > 0),
  } }),
});
const suggestions = [
  { icon: Feather, title: "Find the right words", text: "Draft a thoughtful email, story, or pitch", prompt: "Help me write a clear, thoughtful email. Ask me who it is for and what I want to say." },
  { icon: Code2, title: "Build something useful", text: "Turn a problem into a working solution", prompt: "Help me turn an idea into a small coding project. Ask about my idea and experience first." },
  { icon: Lightbulb, title: "Think a little bigger", text: "Explore fresh angles on your next idea", prompt: "Be my brainstorming partner. Ask me what challenge I am working on, then help me explore new angles." },
  { icon: Globe2, title: "Make sense of it", text: "Break down a topic, one step at a time", prompt: "Help me understand a complex topic. Ask what I want to learn and what I already know." },
];

function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true"><span /><span /><span /></span>;
}

function ModelPicker({ value, onChange, disabled }: { value: ModelId; onChange: (model: ModelId) => void; disabled?: boolean }) {
  const model = findModel(value)!;
  return <DropdownMenu><DropdownMenuTrigger className="model-trigger" disabled={disabled} aria-label={`Select model, current: ${model.name}`}>
    <span className={`provider-mark ${model.color}`}>{model.mark}</span><span>{model.name}</span><ChevronDown size={15} />
  </DropdownMenuTrigger><DropdownMenuContent className="model-menu" sideOffset={12}>
    <div className="menu-heading">CHOOSE YOUR MODEL<span>One conversation. More possibilities.</span></div>
    {MODELS.map((item) => <DropdownMenuItem className="model-option" key={item.id} onClick={() => onChange(item.id)}>
      <span className={`provider-mark ${item.color}`}>{item.mark}</span><span className="model-option-copy"><strong>{item.name}</strong><small>{item.provider} · {item.description}</small></span>{item.id === value && <Check size={16} />}
    </DropdownMenuItem>)}
  </DropdownMenuContent></DropdownMenu>;
}

export function ChatWorkspace() {
  const state = useSyncExternalStore(conversations.subscribe, conversations.getSnapshot, conversations.getServerSnapshot);
  const [search, setSearch] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [edit, setEdit] = useState<{ id: string; title: string; action: "rename" | "delete" } | null>(null);
  const [config, setConfig] = useState<{ demo: boolean; enabled: boolean } | null>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { conversations.hydrate(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal }).then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then(setConfig).catch(() => {});
    return () => controller.abort();
  }, []);
  const active = state.conversations.find((c) => c.id === state.activeId);
  const newChat = () => { conversations.create(); setMobileOpen(false); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setMobileOpen(true); setTimeout(() => searchRef.current?.focus(), 50); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") { event.preventDefault(); conversations.create(); setMobileOpen(false); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const filtered = [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt).filter((c) => c.title.toLowerCase().includes(search.toLowerCase()) || c.messages.some((m) => m.parts.some((p) => p.type === "text" && p.text.toLowerCase().includes(search.toLowerCase()))));
  const sidebar = <>
    <div className="sidebar-brand"><Brand small /><span>numbase<span className="brand-ai">AI</span></span></div>
    <button className="new-chat" onClick={newChat}><Plus size={18} />New conversation<span>↗</span></button>
    <div className="search-box"><Search size={16} /><input ref={searchRef} placeholder="Search conversations" aria-label="Search conversations" value={search} onChange={(e) => setSearch(e.target.value)} /><kbd>⌘ K</kbd></div>
    <div className="sidebar-label">YOUR CONVERSATIONS<span>{state.conversations.filter((c) => c.messages.length).length}</span></div>
    <nav className="conversation-list" aria-label="Conversations">
      {!state.ready ? <p className="sidebar-empty">Opening your workspace…</p> : filtered.length === 0 ? <p className="sidebar-empty">No conversations found.</p> : filtered.map((c) => <div className={`conversation-row ${c.id === state.activeId ? "selected" : ""}`} key={c.id}>
        <button className="conversation-link" aria-current={c.id === state.activeId ? "page" : undefined} onClick={() => { conversations.select(c.id); setMobileOpen(false); }}><MessageSquare size={15} /><span>{c.title}</span></button>
        <DropdownMenu><DropdownMenuTrigger className="conversation-more icon-button" aria-label={`Options for ${c.title}`}><MoreHorizontal size={17} /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => setEdit({ id: c.id, title: c.title, action: "rename" })}><Pencil size={14} />Rename</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setEdit({ id: c.id, title: c.title, action: "delete" })}><Trash2 size={14} />Delete</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </div>)}
    </nav>
    <div className="sidebar-bottom"><div className="workspace-note"><span className="note-icon"><Sparkles size={17} /></span><strong>A little more possibility.</strong><p>Your favorite models.<br />One space to think.</p><button onClick={() => setSettings(true)}>About your workspace <ArrowUpRight size={14} /></button></div>
      <div className="profile-row"><span className="avatar">N</span><div><strong>Personal workspace</strong><small>Saved on this browser</small></div><button className="icon-button" aria-label="Workspace settings" onClick={() => setSettings(true)}><SlidersHorizontal size={17} /></button></div>
    </div>
  </>;
  return <div className="numbase-app">
    <a className="skip-link" href="#composer">Skip to message composer</a>
    <aside className="desktop-sidebar">{sidebar}</aside>
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent side="left" className="mobile-sidebar-dialog"><SheetTitle className="sr-only">Your conversations</SheetTitle><SheetDescription className="sr-only">Search, open, or create a conversation.</SheetDescription>{sidebar}</SheetContent></Sheet>
    {active ? <ChatPane key={active.id} conversation={active} config={config} onOpenSidebar={() => setMobileOpen(true)} onSettings={() => setSettings(true)} /> : <main className="loading-workspace"><Brand /><span>Opening your workspace…</span></main>}
    <Dialog open={settings} onOpenChange={setSettings}><DialogContent className="settings-dialog"><DialogTitle>Your workspace</DialogTitle><DialogDescription>A quieter place for your best ideas.</DialogDescription>
      <div className="settings-section"><strong>Appearance</strong><div className="theme-options"><button className={resolvedTheme === "light" ? "active" : ""} onClick={() => setTheme("light")}><Sun size={17} />Light</button><button className={resolvedTheme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}><Moon size={17} />Dark</button><button onClick={() => setTheme("system")}>System</button></div></div>
      <div className="settings-section"><strong>{config?.demo ? "Demo mode" : config?.enabled ? "OpenRouter connected" : "Connection setup"}</strong><p>{config?.demo ? "Try the experience with a sample streaming response. Add OPENROUTER_API_KEY to your server’s .env.local file and restart to receive real answers." : config?.enabled ? "Messages are sent through OpenRouter to the provider you choose. Your API key stays on the server." : "Live chat is waiting for server configuration. See the project README for setup."}</p></div>
      <div className="settings-section"><strong>Your conversations</strong><p>Chat history is saved in this browser, not synced to an account. Clearing browser data removes it. Live messages are shared with your selected model provider.</p></div>
      <div className="settings-shortcuts"><span>Find a conversation <kbd>Ctrl / ⌘ K</kbd></span><span>New conversation <kbd>Ctrl / ⌘ ⇧ O</kbd></span></div>
    </DialogContent></Dialog>
    <Dialog open={Boolean(edit)} onOpenChange={(open) => { if (!open) setEdit(null); }}><DialogContent><DialogTitle>{edit?.action === "delete" ? "Delete conversation?" : "Rename conversation"}</DialogTitle><DialogDescription>{edit?.action === "delete" ? "This removes the conversation from this browser. This cannot be undone." : "Give this conversation a name you’ll recognize."}</DialogDescription>
      <form onSubmit={(e) => { e.preventDefault(); if (!edit) return; if (edit.action === "delete") conversations.remove(edit.id); else if (edit.title.trim()) conversations.update(edit.id, { title: edit.title.trim() }); setEdit(null); }}>
        {edit?.action === "rename" && <input className="rename-input" aria-label="Conversation name" maxLength={100} autoFocus value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />}
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setEdit(null)}>Cancel</button><button type="submit" className={edit?.action === "delete" ? "danger-button" : "primary-button"} disabled={edit?.action === "rename" && !edit.title.trim()}>{edit?.action === "delete" ? "Delete" : "Save name"}</button></div>
      </form>
    </DialogContent></Dialog>
  </div>;
}

function ChatPane({ conversation, config, onOpenSidebar, onSettings }: { conversation: Conversation; config: { demo: boolean; enabled: boolean } | null; onOpenSidebar: () => void; onSettings: () => void }) {
  const { messages, sendMessage, status, error, stop, regenerate, clearError } = useChat<ChatMessage>({ id: conversation.id, messages: conversation.messages, transport, messageMetadataSchema: metadataSchema, throttle: 50 });
  const [input, setInput] = useState("");
  const [nearBottom, setNearBottom] = useState(true);
  const { resolvedTheme, setTheme } = useTheme();
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const busy = status === "streaming" || status === "submitted";
  useEffect(() => { conversations.saveMessages(conversation.id, messages); }, [conversation.id, messages]);
  useEffect(() => () => { void stop(); }, [stop]);
  useEffect(() => {
    if (nearBottom && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, status, nearBottom]);
  useEffect(() => {
    if (textarea.current) { textarea.current.style.height = "auto"; textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`; }
  }, [input]);
  const submit = () => {
    if (!input.trim() || busy || config?.enabled === false) return;
    const text = input.trim(); setInput(""); clearError(); setNearBottom(true);
    void sendMessage({ text }, { body: { model: conversation.model } });
  };
  return <main className="chat-main">
    <header className="chat-header"><div className="header-left"><button className="icon-button mobile-menu-toggle" aria-label="Open conversations" onClick={onOpenSidebar}><PanelLeft size={20} /></button><ModelPicker value={conversation.model} onChange={(model) => conversations.setModel(conversation.id, model)} disabled={busy} /><span className="header-divider" /><span className="header-subtitle">Your space to think</span></div><div className="header-right"><button className={`connection-badge ${config?.demo ? "demo" : ""}`} onClick={onSettings}><span />{config ? config.demo ? "Demo mode" : config.enabled ? "Connected" : "Setup needed" : "Workspace"}</button><button className="icon-button theme-toggle" aria-label="Toggle color theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}><Sun className="sun-icon" size={18} /><Moon className="moon-icon" size={18} /></button></div></header>
    <div className={`chat-scroll ${messages.length ? "has-messages" : ""}`} ref={scroller} onScroll={() => { const element = scroller.current; if (element) setNearBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 140); }}>
      {messages.length === 0 ? <section className="welcome"><div className="welcome-eyebrow"><span />A WORLD OF IDEAS, ONE CONVERSATION</div><Brand /><h1>Where should we<br /><span>take your mind today?</span></h1><p>A question, a spark, a half-formed idea.<br className="mobile-break" /> Let’s make something of it.</p>
        <div className="suggestion-grid">{suggestions.map(({ icon: Icon, title, text, prompt }) => <button className="suggestion-card" key={title} onClick={() => { setInput(prompt); textarea.current?.focus(); }}><div><span className="suggestion-icon"><Icon size={19} strokeWidth={1.6} /></span><ArrowUpRight size={15} className="suggestion-arrow" /></div><strong>{title}</strong><span>{text}</span></button>)}</div>
        <div className="provider-caption"><span className="mini-provider">O</span><span className="mini-provider">A</span><span className="mini-provider">G</span><span>Different strengths. Endless possibilities.</span></div>
      </section> : <div className="message-list" role="log" aria-label="Conversation messages" aria-busy={busy}>
        {messages.map((message) => {
          const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
          const model = message.metadata ? findModel(message.metadata.modelId) : undefined;
          return <article className={`message ${message.role}`} key={message.id}>{message.role === "assistant" && <div className="message-byline"><Brand small /><strong>Numbase</strong><span>{model?.name ?? "Assistant"}</span>{message.metadata?.demo && <small>Demo</small>}</div>}
            {message.role === "user" ? <div className="user-bubble">{text}</div> : <MessageMarkdown text={text} />}
            {message.role === "assistant" && text && <div className="message-actions"><button className="icon-button" aria-label="Copy response" onClick={() => copyText(text)}><Copy size={15} /></button>{message.id === messages.at(-1)?.id && !busy && <button className="icon-button" aria-label="Regenerate response" onClick={() => { clearError(); void regenerate({ body: { model: conversation.model } }); }}><RotateCcw size={15} /></button>}</div>}
          </article>;
        })}
        {status === "submitted" && <div className="thinking" role="status"><Brand small /><span>Making room for an answer</span><Loader2 size={16} className="spin" /></div>}
      </div>}
    </div>
    <div className="composer-area">
      {!nearBottom && messages.length > 0 && <button className="jump-button" aria-label="Jump to latest message" onClick={() => { setNearBottom(true); scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }}><ArrowDown size={17} /></button>}
      {error && <div className="chat-error" role="alert"><span>{error.message || "Something went wrong. Please try again."}</span><button onClick={() => { clearError(); void regenerate({ body: { model: conversation.model } }); }}>Retry</button><button aria-label="Dismiss error" onClick={clearError}><X size={15} /></button></div>}
      {config && !config.enabled && <div className="chat-error">Live chat needs server configuration. <button onClick={onSettings}>View details</button></div>}
      <form className={`composer ${busy ? "is-streaming" : ""}`} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label htmlFor="composer" className="sr-only">Message Numbase AI</label><textarea id="composer" ref={textarea} placeholder="Ask anything. Start somewhere." value={input} onChange={(e) => setInput(e.target.value)} maxLength={16_000} rows={2} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        <div className="composer-toolbar"><span className="composer-model"><Sparkles size={14} /><span>{findModel(conversation.model)?.name}</span></span><div className="composer-send"><span className="enter-hint">{busy ? "Creating a response…" : "Shift + Enter for a new line"}</span>{busy ? <button className="send-button" type="button" aria-label="Stop response" onClick={() => { void stop(); }}><Square size={16} fill="currentColor" /></button> : <button className="send-button" type="submit" aria-label="Send message" disabled={!input.trim() || config?.enabled === false}><ArrowUp size={20} /></button>}</div></div>
      </form><p className="composer-disclaimer">{config?.demo ? "Demo mode uses sample responses. Connect OpenRouter for live answers." : "A little perspective goes a long way. Always double-check important details."}</p>
    </div>
  </main>;
}
