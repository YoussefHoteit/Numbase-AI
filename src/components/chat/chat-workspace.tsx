"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowUpRight,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { conversations } from "@/lib/conversations";
import type { ChatConfig } from "@/lib/chat-schema";
import { Brand } from "./brand";
import { ChatPane } from "./chat-pane";
import { WorkspaceSettings } from "./workspace-settings";
import { FileManager } from "./file-manager";

export function ChatWorkspace() {
  const state = useSyncExternalStore(
    conversations.subscribe,
    conversations.getSnapshot,
    conversations.getServerSnapshot,
  );
  const [search, setSearch] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [edit, setEdit] = useState<{
    id: string;
    title: string;
    action: "rename" | "delete";
  } | null>(null);
  const [config, setConfig] = useState<ChatConfig | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    conversations.hydrate();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then(setConfig)
      .catch(() => {
        // Leave availability unknown if the check fails; the chat route reports errors.
      });
    return () => controller.abort();
  }, []);
  const active = state.conversations.find((c) => c.id === state.activeId);
  const newChat = () => {
    conversations.create();
    setMobileOpen(false);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMobileOpen(true);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        conversations.create();
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const query = search.toLowerCase();
  const filtered = [...state.conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(
      (conversation) =>
        conversation.title.toLowerCase().includes(query) ||
        conversation.messages.some((message) =>
          message.parts.some(
            (part) =>
              part.type === "text" && part.text.toLowerCase().includes(query),
          ),
        ),
    );
  const saveEdit = () => {
    if (!edit) return;
    if (edit.action === "delete") conversations.remove(edit.id);
    else if (edit.title.trim())
      conversations.update(edit.id, { title: edit.title.trim() });
    setEdit(null);
  };
  const sidebar = (
    <>
      <div className="sidebar-brand">
        <Brand small />
        <span>
          numbase<span className="brand-ai">AI</span>
        </span>
      </div>
      <button className="new-chat" onClick={newChat}>
        <Plus size={18} />
        New conversation<span>↗</span>
      </button>
      <div className="search-box">
        <Search size={16} />
        <input
          ref={searchRef}
          placeholder="Search conversations"
          aria-label="Search conversations"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <kbd>⌘ K</kbd>
      </div>
      <div className="sidebar-label">
        YOUR CONVERSATIONS
        <span>
          {state.conversations.filter((c) => c.messages.length).length}
        </span>
      </div>
      <nav className="conversation-list" aria-label="Conversations">
        {!state.ready ? (
          <p className="sidebar-empty">Opening your workspace…</p>
        ) : filtered.length === 0 ? (
          <p className="sidebar-empty">No conversations found.</p>
        ) : (
          filtered.map((c) => (
            <div
              className={`conversation-row ${c.id === state.activeId ? "selected" : ""}`}
              key={c.id}
            >
              <button
                className="conversation-link"
                aria-current={c.id === state.activeId ? "page" : undefined}
                onClick={() => {
                  conversations.select(c.id);
                  setMobileOpen(false);
                }}
              >
                <MessageSquare size={15} />
                <span>{c.title}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="conversation-more icon-button"
                  aria-label={`Options for ${c.title}`}
                >
                  <MoreHorizontal size={17} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={() =>
                      setEdit({ id: c.id, title: c.title, action: "rename" })
                    }
                  >
                    <Pencil size={14} />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      setEdit({ id: c.id, title: c.title, action: "delete" })
                    }
                  >
                    <Trash2 size={14} />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </nav>
      <div className="sidebar-bottom">
        {config?.lifecycle && <FileManager />}
        <div className="workspace-note">
          <span className="note-icon">
            <Sparkles size={17} />
          </span>
          <strong>A little more possibility.</strong>
          <p>
            Your favorite models.
            <br />
            One space to think.
          </p>
          <button onClick={() => setSettings(true)}>
            About your workspace <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="profile-row">
          <span className="avatar">N</span>
          <div>
            <strong>Personal workspace</strong>
            <small>Saved on this browser</small>
          </div>
          <button
            className="icon-button"
            aria-label="Workspace settings"
            onClick={() => setSettings(true)}
          >
            <SlidersHorizontal size={17} />
          </button>
        </div>
      </div>
    </>
  );
  return (
    <div className="numbase-app">
      <a className="skip-link" href="#composer">
        Skip to message composer
      </a>
      <aside className="desktop-sidebar">{sidebar}</aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="mobile-sidebar-dialog">
          <SheetTitle className="sr-only">Your conversations</SheetTitle>
          <SheetDescription className="sr-only">
            Search, open, or create a conversation.
          </SheetDescription>
          {sidebar}
        </SheetContent>
      </Sheet>
      {/* Only changing chats remounts the message state; selecting a model must keep it. */}
      {active ? (
        <ChatPane
          key={active.id}
          conversation={active}
          config={config}
          onOpenSidebar={() => setMobileOpen(true)}
          onSettings={() => setSettings(true)}
        />
      ) : (
        <main className="loading-workspace">
          <Brand />
          <span>Opening your workspace…</span>
        </main>
      )}
      <WorkspaceSettings
        open={settings}
        onOpenChange={setSettings}
        config={config}
      />
      <Dialog
        open={Boolean(edit)}
        onOpenChange={(open) => {
          if (!open) setEdit(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {edit?.action === "delete"
              ? "Delete conversation?"
              : "Rename conversation"}
          </DialogTitle>
          <DialogDescription>
            {edit?.action === "delete"
              ? "This removes the conversation from this browser. This cannot be undone."
              : "Give this conversation a name you’ll recognize."}
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveEdit();
            }}
          >
            {edit?.action === "rename" && (
              <input
                className="rename-input"
                aria-label="Conversation name"
                maxLength={100}
                autoFocus
                value={edit.title}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEdit(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={
                  edit?.action === "delete" ? "danger-button" : "primary-button"
                }
                disabled={edit?.action === "rename" && !edit.title.trim()}
              >
                {edit?.action === "delete" ? "Delete" : "Save name"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
