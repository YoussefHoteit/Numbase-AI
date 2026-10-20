"use client";
import { z } from "zod";
import { toast } from "sonner";
import {
  conversationSchema,
  type Conversation,
  type ChatMessage,
} from "./chat-schema.ts";
import { DEFAULT_MODEL, type ModelId } from "./models.ts";
import { snapshotTextMessages } from "./chat-history.ts";
const KEY = "numbase.conversations.v2";
const LEGACY_KEY = "numbase.conversations.v1";
const workspaceSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  activeId: z.string().catch(""),
  conversations: z.array(z.unknown()),
});
type State = {
  ready: boolean;
  activeId: string;
  conversations: Conversation[];
};
const initial: State = { ready: false, activeId: "", conversations: [] };
let state = initial;
let warned = false;
let canPersist = true;
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((listener) => listener());
}
function emptyConversation(): Conversation {
  return { id: crypto.randomUUID(), title: "New conversation", model: DEFAULT_MODEL, updatedAt: Date.now(), messages: [] };
}
function preserveRecovery(saved: string) {
  // Keep the exact bytes before any later user action can replace damaged data.
  // If storage is full, stay in memory rather than sacrificing the only copy.
  try {
    const key = `${KEY}.recovery.${Date.now()}.${crypto.randomUUID()}`;
    localStorage.setItem(key, saved);
    canPersist = localStorage.getItem(key) === saved;
  } catch {
    canPersist = false;
  }
  toast.error(canPersist
    ? "Some saved history could not be loaded. A recovery copy was kept; valid conversations are available."
    : "Saved history could not be fully loaded or backed up. Changes will stay in this session to protect the original data.");
}
function publish(next: State) {
  state = next;
  try {
    if (canPersist) localStorage.setItem(KEY, JSON.stringify({ ...state, version: 2 }));
  } catch {
    if (!warned)
      toast.error(
        "Browser storage is unavailable or full. New changes will last only for this session.",
      );
    warned = true;
  }
  notify();
}
export const conversations = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => state,
  // A stable empty snapshot keeps server rendering and initial hydration aligned.
  getServerSnapshot: () => initial,
  hydrate() {
    if (state.ready) return;
    try {
      // Keep the v1 entry intact as a recovery copy after migration.
      const saved = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
      if (saved !== null) {
        let parsed: unknown;
        try { parsed = JSON.parse(saved); }
        catch { preserveRecovery(saved); }
        const result = workspaceSchema.safeParse(parsed);
        if (result.success) {
          const chats = result.data.conversations.map((entry) => conversationSchema.safeParse(entry));
          const valid = chats.flatMap((entry) => entry.success ? [entry.data] : []);
          const damaged = valid.length !== chats.length;
          if (damaged) preserveRecovery(saved);
          const restored = valid.length ? valid : [emptyConversation()];
          state = {
            ready: true,
            conversations: restored,
            activeId: restored.some(
              (c) => c.id === result.data.activeId,
            )
              ? result.data.activeId
              : restored[0].id,
          };
          notify();
          // Never rewrite the raw entry during recovery. Normal v1 migration is safe.
          if (result.data.version === 1 && !damaged) publish(state);
          return;
        }
        if (parsed !== undefined) preserveRecovery(saved);
        state = { ready: true, activeId: "", conversations: [emptyConversation()] };
        state.activeId = state.conversations[0].id;
        notify();
        return;
      }
    } catch {
      canPersist = false;
      toast.error(
        "Could not read browser storage. Conversations may not persist.",
      );
    }
    this.create();
  },
  create() {
    const empty = state.conversations.find(
      (c) => c.messages.length === 0 && c.title === "New conversation",
    );
    if (empty) {
      this.select(empty.id);
      return;
    }
    const conversation = emptyConversation();
    publish({
      ready: true,
      activeId: conversation.id,
      conversations: [conversation, ...state.conversations],
    });
  },
  select(id: string) {
    publish({ ...state, activeId: id });
  },
  update(
    id: string,
    patch: Partial<Pick<Conversation, "title" | "model" | "messages">>,
  ) {
    const current = state.conversations.find((c) => c.id === id);
    if (
      !current ||
      Object.entries(patch).every(
        ([key, value]) => current[key as keyof Conversation] === value,
      )
    )
      return;
    publish({
      ...state,
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c,
      ),
    });
  },
  saveMessages(id: string, messages: ChatMessage[]) {
    const current = state.conversations.find((c) => c.id === id);
    if (!current) return;
    const first = messages
      .find((m) => m.role === "user")
      ?.parts.find((p) => p.type === "text");
    const title =
      current.title === "New conversation"
        ? first?.type === "text" && first.text.trim() ? first.text.trim().slice(0, 60) : messages.find((message) => message.role === "user")?.parts.find((part) => part.type === "file")?.filename?.slice(0, 60) ?? "Image conversation"
        : current.title;
    const savedMessages = snapshotTextMessages(messages);
    // Streaming notifications can repeat; avoid rewriting unchanged browser data.
    if (JSON.stringify(current.messages) === JSON.stringify(savedMessages))
      return;
    this.update(id, { messages: savedMessages, ...(title ? { title } : {}) });
  },
  setModel(id: string, model: ModelId) {
    this.update(id, { model });
  },
  remove(id: string) {
    const remaining = state.conversations.filter((c) => c.id !== id);
    if (!remaining.length) {
      state = { ...state, conversations: [], activeId: "" };
      this.create();
      return;
    }
    publish({
      ...state,
      conversations: remaining,
      activeId: state.activeId === id ? remaining[0].id : state.activeId,
    });
  },
};
