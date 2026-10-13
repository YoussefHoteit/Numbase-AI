# Numbase-AI

A multi-model AI chat workspace built with Next.js App Router, TypeScript, Tailwind CSS, Base UI/shadcn/ui, OpenRouter, and Vercel AI SDK 7.

**Application:** https://numbase-ai.vercel.app/

**Repository:** https://github.com/YoussefHoteit/Numbase-AI

**Hosting target:** Vercel Hobby. This repository and deployment are the continuing project for future work.

## Vercel setup

1. Import this GitHub repository into the existing Numbase AI Vercel project. Keep `main` as the production branch and use the repository root as the Root Directory.
2. Select the Next.js framework preset. `vercel.json` specifies `npm ci` for installation and `npm run build` for builds. Use Node.js 22 or newer, as required by the OpenRouter provider.
3. In **Project Settings > Environment Variables**, add `OPENROUTER_API_KEY` for **Production** using the key provided for this assignment. Store its value only in Vercel. Do not create a credentials file, commit it, or place it in a browser variable.
4. Use protected testing for live responses. In **Vercel Security > Deployment Protection**, enable Vercel Authentication for **All Deployments**, including the production domain. Verify both the page and `/api/chat` require authorized access. Then set `NUMBASE_DEPLOYMENT_PROTECTED=true` for Production. This flag acknowledges configured access protection; it does not itself implement authentication. [Vercel supports protecting production deployments on every plan](https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan).
5. Redeploy from `main` after changing environment variables. Confirm `/api/config` reports `demo: false` and `enabled: true`, then perform the live context test below. Set an appropriate spending limit for the assignment key in OpenRouter before enabling paid usage.

The `.env.example` file is an empty variable reference, not a place to store credentials. No `NEXT_PUBLIC_` secret is used. API calls use same-origin `/api/chat` and `/api/config`, so Vercel production and preview URLs work without a separate API host.

The chat function allows 60 seconds and stops provider work after 55 seconds. This is within the Vercel Hobby limit with Fluid Compute and does not require a paid plan. See [Vercel function limits](https://vercel.com/docs/functions/limitations).

## Features

- Streamed responses with stop, retry, regenerate, and copy controls.
- Markdown, tables, highlighted code blocks, and code copying.
- Create, search, rename, delete, and reopen conversations.
- Switch models during a conversation while retaining its message history.
- Each response retains its producing model label after switching and reloading.
- Desktop and mobile navigation, light/dark/system appearance, and keyboard shortcuts.
- Clear messages for rate limits, unavailable models, timeouts, connection settings, and exhausted credits.
- Explicit sample-response demo mode when the Vercel key is not configured.

## Models

| Model | Provider | OpenRouter ID |
| --- | --- | --- |
| GPT-4.1 Mini | OpenAI | `openai/gpt-4.1-mini` |
| GPT-4.1 | OpenAI | `openai/gpt-4.1` |
| Claude Sonnet 4.5 | Anthropic | `anthropic/claude-sonnet-4.5` |
| Gemini 2.5 Flash | Google | `google/gemini-2.5-flash` |

These four models cover three providers. Their allowlist and labels are in `src/lib/models.ts`. Availability, price, and capabilities are controlled by OpenRouter and the underlying providers.

## How context survives a model switch

`ChatPane` is keyed by conversation ID, not model ID. Changing the selector updates only the conversation's `model`; it does not clear the AI SDK messages. On every turn, `DefaultChatTransport` sends the selected model and the active conversation's complete text history. The server validates that history and forwards all of its user/assistant messages to the newly selected OpenRouter model.

For example, the second request after switching from GPT-4.1 Mini to Claude Sonnet contains:

```json
{
  "model": "anthropic/claude-sonnet-4.5",
  "messages": [
    {"id": "1", "role": "user", "parts": [{"type": "text", "text": "Remember our project codename is Cedar."}]},
    {"id": "2", "role": "assistant", "parts": [{"type": "text", "text": "I will remember Cedar."}]},
    {"id": "3", "role": "user", "parts": [{"type": "text", "text": "What is our project codename?"}]}
  ]
}
```

This is an illustrative request shape, not a recorded live-model result.

### Live acceptance test

After Vercel is configured for live responses:

1. Select GPT-4.1 Mini and send: `Remember that our project codename is Cedar and our launch month is October.`
2. Wait for the response, switch to Claude Sonnet 4.5, and ask: `What codename and launch month did I give you?`
3. Confirm the response recalls **Cedar** and **October**, with a Claude label, while the previous response retains its GPT label.
4. Switch to Gemini 2.5 Flash and ask it to summarize the same conversation. Then try GPT-4.1.
5. Reload and reopen the conversation; verify its history and model labels remain.

Demo mode tests interface behavior only. It cannot prove model recall or provider connectivity. Live-provider acceptance remains pending until the provided key is configured and this test passes. An optional 2–3 minute video can show this procedure along with themes and conversation management.

## Checks

```powershell
npm ci
npm run lint
npm run build
npm run test:unit
npm run test:api
```

The API suite targets the deployed application by default. Set `TEST_BASE_URL` only when checking another Vercel deployment. It verifies configuration safety, origin checks, validation, payload limits, and sample streaming. Sample-response tests are explicitly skipped when the target is live, so the suite never intentionally spends model credits. The live acceptance test above is separate.

## Architecture and security

- `src/components/chat/`: interface, model selector, and Markdown rendering.
- `src/lib/conversations.ts`: versioned, validated browser storage.
- `src/lib/chat-schema.ts`: message, model, and conversation validation.
- `src/lib/server/`: bounded request reading, sample streaming, safe provider errors, and rate limiting.
- `src/app/api/chat/route.ts`: server-side OpenRouter calls and AI SDK UI message streams.
- `src/app/api/config/route.ts`: connection status without credentials.

The key is read only by server routes. Client-supplied system roles, arbitrary models, files, and tool requests are rejected. Provider response bodies and credential details are not displayed. Raw Markdown HTML is not executed and remote Markdown images are not fetched.

## Known limitations and readiness

- Without `OPENROUTER_API_KEY` in Vercel, responses are labeled samples and do not answer prompts.
- The public demo works without an API key. The chosen live-testing configuration retains the production guard and requires Vercel access protection. An unauthenticated visitor cannot use the paid live app in that configuration. Arrange reviewer access for the live demonstration; a later anonymous public paid launch needs a separate owner decision and appropriate spending controls.
- History is saved in the current browser, not synced to an account. Clearing browser data removes it. Live message history is sent through OpenRouter to the selected provider.
- Requests are limited to 128 KB, 100 messages, 32,000 characters per text part, and 64,000 total conversation characters. History is not silently trimmed. At the limit, start a new conversation; automatic summarization is future work.
- Model output is capped at 4,096 tokens. The supplied assignment key expires after one month and must be renewed or removed in Vercel when it expires.
- The included limiter permits 20 valid requests per minute per server process. It is not a shared per-user limit across Vercel instances. Origin checks are CSRF protection, not authentication. Configure cost limits before enabling paid public usage.
- The UI and demo API can be verified without a key. Provider availability, provider rate limits, and cross-provider recall still require live testing.
- The GitHub repository must be public or shared with the reviewer before submission. Deadline: **23 October 2026**.

Review compatible dependency updates instead of using `npm audit fix --force`.
