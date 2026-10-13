"use client";
import { z } from "zod";
import { toast } from "sonner";
import { conversationSchema, type Conversation, type ChatMessage } from "./chat-schema";
import { DEFAULT_MODEL, type ModelId } from "./models";
const KEY = "numbase.conversations.v1";
const schema = z.object({ version: z.literal(1), activeId: z.string(), conversations: z.array(conversationSchema) });
type State = { ready: boolean; activeId: string; conversations: Conversation[] };
const initial: State = { ready: false, activeId: "", conversations: [] };
let state = initial;
let warned = false;
const listeners = new Set<() => void>();
function publish(next: State) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify({ ...state, version: 1 })); }
  catch {
    if (!warned) toast.error("Browser storage is unavailable or full. New changes will last only for this session.");
    warned = true;
  }
  listeners.forEach((listener) => listener());
}
export const conversations = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => state,
  getServerSnapshot: () => initial,
  hydrate() {
    if (state.ready) return;
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        const result = schema.safeParse(JSON.parse(saved));
        if (result.success && result.data.conversations.length) {
          state = { ready: true, conversations: result.data.conversations,
            activeId: result.data.conversations.some((c) => c.id === result.data.activeId) ? result.data.activeId : result.data.conversations[0].id };
          listeners.forEach((listener) => listener()); return;
        }
        toast.error("Saved conversations could not be loaded. A new workspace has been opened.");
      }
    } catch { toast.error("Could not read browser storage. Conversations may not persist."); }
    this.create();
  },
  create() {
    const empty = state.conversations.find((c) => c.messages.length === 0 && c.title === "New conversation");
    if (empty) { this.select(empty.id); return; }
    const conversation: Conversation = { id: crypto.randomUUID(), title: "New conversation", model: DEFAULT_MODEL, updatedAt: Date.now(), messages: [] };
    publish({ ready: true, activeId: conversation.id, conversations: [conversation, ...state.conversations] });
  },
  select(id: string) { publish({ ...state, activeId: id }); },
  update(id: string, patch: Partial<Pick<Conversation, "title" | "model" | "messages">>) {
    const current = state.conversations.find((c) => c.id === id);
    if (!current || Object.entries(patch).every(([key, value]) => current[key as keyof Conversation] === value)) return;
    publish({ ...state, conversations: state.conversations.map((c) => c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c) });
  },
  saveMessages(id: string, messages: ChatMessage[]) {
    const current = state.conversations.find((c) => c.id === id);
    const first = messages.find((m) => m.role === "user")?.parts.find((p) => p.type === "text");
    const title = current?.title === "New conversation" && first?.type === "text" ? first.text.trim().slice(0, 60) : current?.title;
    const savedMessages = messages.map((message) => ({ ...message, parts: message.parts.filter((part) => part.type === "text") }))
      .filter((message) => message.parts.length > 0);
    if (JSON.stringify(current?.messages) === JSON.stringify(savedMessages)) return;
    this.update(id, { messages: savedMessages, ...(title ? { title } : {}) });
  },
  setModel(id: string, model: ModelId) { this.update(id, { model }); },
  remove(id: string) {
    const remaining = state.conversations.filter((c) => c.id !== id);
    if (!remaining.length) { state = { ...state, conversations: [], activeId: "" }; this.create(); return; }
    publish({ ...state, conversations: remaining, activeId: state.activeId === id ? remaining[0].id : state.activeId });
  },
};
