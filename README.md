# Numbase AI

A multi-model chat application built for the Numbase internship assignment.

**Live deployment:** [numbase-ai.vercel.app](https://numbase-ai.vercel.app/)

## Tech stack

- **Frontend:** Next.js App Router, React, TypeScript, Tailwind CSS 4, and shadcn/ui with Base UI.
- **AI integration:** Vercel AI SDK and OpenRouter.
- **Rendering and themes:** react-markdown, remark-gfm, rehype-highlight, and next-themes.
- **Storage and hosting:** Browser localStorage and Vercel Hobby.

## How it was built

The chat interface sends the selected model and the complete conversation text to `/api/chat`. The server validates the request, calls OpenRouter, and streams the response through the Vercel AI SDK. API keys are read only on the server from Vercel environment variables.

Conversations are stored in the browser. Switching models keeps the same user and assistant messages; the new selection applies to the next reply. Each response retains its original model label.

**Live context check:** Details introduced with GPT-4.1 Mini—an imaginary purple otter and the number 17—were correctly recalled after switching to Claude, Gemini, and Mistral without repeating those details in the follow-up prompts.

## Features implemented

- Streaming responses with stop, retry, regenerate, and copy controls.
- Markdown, tables, syntax-highlighted code blocks, and code copying.
- Create, search, rename, delete, and reopen conversations.
- Model switching with full conversation history and per-response model labels.
- Responsive desktop/mobile layouts with light, dark, and system themes.
- Request validation, size limits, rate limiting, and clear connection/provider errors.

## Models used

| Provider | Model | OpenRouter ID |
| --- | --- | --- |
| OpenAI | GPT-4.1 Mini | `openai/gpt-4.1-mini` |
| Anthropic | Claude Haiku 4.5 | `anthropic/claude-haiku-4.5` |
| Google | Gemini 2.5 Flash-Lite | `google/gemini-2.5-flash-lite` |
| Mistral | Mistral Small 3.2 | `mistralai/mistral-small-3.2-24b-instruct` |

## Setup

1. Install Node.js 22 or newer, clone the repository, and run `npm ci`.
2. Import the repository into Vercel using the Next.js preset and repository root.
3. Add `OPENROUTER_API_KEY` to Vercel's **Production Environment Variables**. Keep the key only in Vercel; never add it to project files or client-side variables.
4. Enable **Vercel Authentication → All Deployments**, including production, then set `NUMBASE_DEPLOYMENT_PROTECTED=true` in Production.
5. Deploy `main`. Redeploy after changing environment variables.

To check the source and build:

```sh
npm run lint
npm run build
npm run test:unit
npm run test:api
```

The API suite targets the deployed URL. Checks requiring sign-in are explicitly skipped when deployment protection is enabled.

## Known limitations

- History is local to the current browser; there is no account sync or database.
- Long conversations are limited to 100 messages and 64,000 characters. Automatic history trimming is not implemented.
- Responses are capped at 4,096 output tokens and a 55-second provider timeout.
- Rate limiting is per server process, rather than shared across deployment instances.
- Model availability, credits, and the assignment key's one-month expiry can affect responses. Without a key, the app returns labeled sample responses.
- The deployed app requires approved Vercel access for testing.
