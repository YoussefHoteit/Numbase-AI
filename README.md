# Numbase-AI

A responsive multi-model chat workspace built with Next.js, TypeScript, Tailwind CSS, Base UI, and the Vercel AI SDK.

## Run locally

Requires Node.js 22 or newer.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:3000. With no key configured, the application streams clearly labeled sample responses. This demo does not call an AI provider.

For real responses, set `OPENROUTER_API_KEY` in `.env.local`, then restart the development server. Keep this value server-only: never use a `NEXT_PUBLIC_` variable, browser storage, or a client-side key input. Environment files are ignored except the empty `.env.example` template.

## Features

- Create, search, rename, reopen, and delete conversations.
- Browser-local history with per-response model attribution.
- Four models from OpenAI, Anthropic, and Google, configured in `src/lib/models.ts`.
- Streaming responses with stop, retry, regenerate, and copy actions.
- Markdown, tables, highlighted code blocks, and code copying.
- Responsive navigation, keyboard shortcuts, and light/dark/system appearance.
- Explicit demo mode when no provider key is configured.

History belongs to the current browser; it is not account-synced. Clearing browser data removes history. In live mode, conversation text is sent through OpenRouter to the chosen provider. Raw HTML is not executed and remote Markdown images are not fetched.

## Structure

- `src/components/chat/`: workspace, conversation UI, model menu, and Markdown renderer.
- `src/lib/conversations.ts`: versioned local conversation persistence.
- `src/lib/models.ts`: shared model allowlist and presentation metadata.
- `src/lib/chat-schema.ts`: request and persisted-history validation.
- `src/lib/server/`: bounded request reading, rate limiting, and sample streaming.
- `src/app/api/chat/route.ts`: server-only OpenRouter calls and streaming protocol.
- `src/app/api/config/route.ts`: public connection status, with no credentials.

The client and route use AI SDK 7 UI message streams. Model metadata travels with each response, so switching models never relabels earlier answers. Only text parts are sent back to a provider; client system messages, arbitrary model IDs, files, and tool requests are rejected.

## Verification

```powershell
npm run lint
npm run build
npm start
```

In a second terminal, with `OPENROUTER_API_KEY` unset on the running server:

```powershell
npm run test:api
```

For another port, set `TEST_BASE_URL` to the exact server origin. API tests verify validation, origin checks, payload limits, configuration safety, and streamed metadata for all four models. They refuse to send valid prompts when the server is in live mode.

## Production access

This version is a personal workspace, without account authentication or cloud history. Before enabling paid traffic, protect **both the page and `/api/*`** with hosting authentication or equivalent application authentication, add a shared per-user rate limiter, and set spending limits in OpenRouter. The included 20-requests-per-minute limiter is per process, not a distributed security boundary. Origin checks are CSRF defense, not authentication.

Production builds reject live requests by default. After access protection is in place, set `NUMBASE_DEPLOYMENT_PROTECTED=true` in the hosting environment and restart/redeploy. This flag acknowledges an operator-configured boundary; it does not implement authentication. Demo mode works without the flag. Local `npm run dev` can use a key directly; keep the development server on your trusted machine.

Requests are bounded to 128 KB, 100 messages, 32,000 characters per text part, and 64,000 total conversation characters. Live output is capped at 4,096 tokens with a 55-second deadline. Provider failures return safe error messages. Long conversations should continue in a new chat.

The existing dependency versions and ejected Base UI/shadcn stylesheet are retained. Tailwind processes the global entry stylesheet, which imports the chat styles. Do not use `npm audit fix --force` to resolve future dependency warnings; review compatible updates instead.
