export const MODELS = [
  {
    id: "openai/gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    provider: "OpenAI",
    description: "Quick answers, everyday ideas",
    color: "green",
    mark: "O",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    description: "Faster, lower-cost Claude",
    color: "clay",
    mark: "A",
  },
  {
    id: "google/gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    provider: "Google",
    description: "Budget-friendly everyday chat",
    color: "blue",
    mark: "G",
  },
  {
    id: "mistralai/mistral-small-3.2-24b-instruct",
    name: "Mistral Small 3.2",
    provider: "Mistral",
    description: "Low-cost multilingual chat",
    color: "clay",
    mark: "M",
  },
] as const;
export type ModelId = (typeof MODELS)[number]["id"];
export const DEFAULT_MODEL: ModelId = MODELS[0].id;

// Retain historical labels without offering retired models for new requests.
export const LEGACY_MODELS = [
  {
    id: "anthropic/claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    color: "clay",
    mark: "A",
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    color: "blue",
    mark: "G",
  },
  {
    id: "openai/gpt-4.1",
    name: "GPT-4.1",
    provider: "OpenAI",
    color: "green",
    mark: "O",
  },
] as const;

const REPLACEMENTS: Record<string, ModelId> = {
  "anthropic/claude-sonnet-4.5": "anthropic/claude-haiku-4.5",
  "google/gemini-2.5-flash": "google/gemini-2.5-flash-lite",
  "openai/gpt-4.1": "mistralai/mistral-small-3.2-24b-instruct",
};

export function resolveModelId(id: string): ModelId {
  return (
    MODELS.find((model) => model.id === id)?.id ??
    REPLACEMENTS[id] ??
    DEFAULT_MODEL
  );
}

export const findModel = (id: string) =>
  MODELS.find((model) => model.id === id) ??
  LEGACY_MODELS.find((model) => model.id === id);
