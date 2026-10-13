// Never expose provider response bodies, request details, or credentials to the browser.
export function modelErrorMessage(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    if (!current || typeof current !== "object") break;
    const value = current as { statusCode?: number; name?: string; lastError?: unknown; cause?: unknown };
    if (value.statusCode === 429) return "This model is rate-limited. Wait a minute, or select another model.";
    if (value.statusCode === 402) return "OpenRouter credits are unavailable. The project owner needs to check the account balance.";
    if (value.statusCode === 401 || value.statusCode === 403) return "The model connection needs attention. The project owner should check the Vercel environment settings.";
    if (value.statusCode === 404 || value.statusCode === 503) return "This model is temporarily unavailable. Choose another model and retry.";
    if (value.statusCode === 408 || value.statusCode === 504 || value.name === "TimeoutError") return "The model took too long to respond. Retry or choose a faster model.";
    current = value.lastError ?? value.cause;
  }
  return "The model could not respond. Please retry or choose another model.";
}
