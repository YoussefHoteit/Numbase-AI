export const MODELS = [
  { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "OpenAI", description: "Quick answers, everyday ideas", color: "green", mark: "O" },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "Anthropic", description: "Thoughtful writing and code", color: "clay", mark: "A" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google", description: "Fast, versatile thinking", color: "blue", mark: "G" },
  { id: "openai/gpt-4.1", name: "GPT-4.1", provider: "OpenAI", description: "Detailed work and problem solving", color: "green", mark: "O" },
] as const;
export type ModelId = (typeof MODELS)[number]["id"];
export const DEFAULT_MODEL: ModelId = MODELS[0].id;
export const findModel = (id: string) => MODELS.find((model) => model.id === id);
