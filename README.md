# Numbase-AI

A multi-model AI chat workspace built with Next.js App Router, TypeScript, Tailwind CSS, Base UI/shadcn/ui, OpenRouter, and Vercel AI SDK 7.

**Application:** https://numbase-ai.vercel.app/

**Repository:** https://github.com/YoussefHoteit/Numbase-AI

**Hosting target:** Vercel Hobby. This repository and deployment are the continuing project for future work.

**Review access:** The repository is public. The live application uses Vercel Authentication for all deployments to protect the provided OpenRouter credits. Reviewers should open the application, sign in to Vercel, and request access if prompted. The project owner must approve that request. Do not disable protection or share API keys for a review.

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
| Claude Haiku 4.5 | Anthropic | `anthropic/claude-haiku-4.5` |
| Gemini 2.5 Flash-Lite | Google | `google/gemini-2.5-flash-lite` |
| Mistral Small 3.2 | Mistral | `mistralai/mistral-small-3.2-24b-instruct` |

These four models cover four providers. Their allowlist and labels are in `src/lib/models.ts`. Availability, price, and capabilities are controlled by OpenRouter and the underlying providers.

### Cost-conscious model selection

OpenRouter catalog prices checked on **14 October 2026**, in USD per **one million tokens**:

| Model | Input | Output |
| --- | ---: | ---: |
| GPT-4.1 Mini | $0.40 | $1.60 |
| Claude Haiku 4.5 | $1.00 | $5.00 |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 |
| Mistral Small 3.2 | $0.09375 | $0.25 |

Haiku replaces Sonnet 4.5 ($3 input / $15 output). Flash-Lite replaces Gemini 2.5 Flash ($0.30 / $2.50). Mistral replaces GPT-4.1 ($2 / $8) and adds another provider. Haiku is cheaper than Sonnet but still the highest-priced option in this selection; Mistral and Flash-Lite are useful for inexpensive iteration. Actual charges depend on token usage, caching, and the selected upstream provider. Check the [OpenRouter model catalog](https://openrouter.ai/api/v1/models) for current rates.

Saved conversations using replaced models automatically select their budget replacement when reopened. Their messages and original response model labels remain intact. Replaced models are not offered in the selector or accepted as the target for new provider requests.

## How context survives a model switch

`ChatPane` is keyed by conversation ID, not model ID. Changing the selector updates only the conversation's `model`; it does not clear the AI SDK messages. On every turn, `DefaultChatTransport` sends the selected model and the active conversation's complete text history. The server validates that history and forwards all of its user/assistant messages to the newly selected OpenRouter model.

For example, the second request after switching from GPT-4.1 Mini to Claude Haiku contains:

```json
{
  "model": "anthropic/claude-haiku-4.5",
  "messages": [
    {"id": "1", "role": "user", "parts": [{"type": "text", "text": "Remember our project codename is Cedar."}]},
    {"id": "2", "role": "assistant", "parts": [{"type": "text", "text": "I will remember Cedar."}]},
    {"id": "3", "role": "user", "parts": [{"type": "text", "text": "What is our project codename?"}]}
  ]
}
```

This is an illustrative request shape, not a recorded live-model result.

### Live acceptance test

Use explicitly fictional data when checking context retention:

1. Select GPT-4.1 Mini and send: `Synthetic software test: the following is invented test data, not real personal or project information. Remember an imaginary purple otter and the number 17. Confirm both in one short sentence.`
2. Wait for the response, switch to Claude Haiku 4.5, and ask: `What imaginary animal, color, and number did I give you earlier? Answer in one sentence using the conversation history.`
3. Confirm the response recalls **purple**, **otter**, and **17**, with a Claude label, while the previous response retains its GPT label.
4. Switch to Gemini 2.5 Flash-Lite and request those facts as a Markdown bullet list. Then switch to Mistral Small 3.2 and request the same facts as a fenced JSON code block.
5. Reload and reopen the conversation; verify its history and model labels remain.

### Recorded live results — 17 October 2026

The provided key was configured as a Production Secret in Vercel and the production deployment completed successfully. All four requests below used real OpenRouter responses in the same conversation, with no demo labels:

| Selected model | Observed result |
| --- | --- |
| GPT-4.1 Mini | Confirmed the imaginary purple otter and number 17. |
| Claude Haiku 4.5 | Recalled the purple otter and 17 after switching from GPT, without repeating the facts in the new prompt. |
| Gemini 2.5 Flash-Lite | Recalled all three facts and rendered them as a Markdown bullet list. |
| Mistral Small 3.2 | Returned a rendered JSON code block containing `animal: otter`, `color: purple`, and `number: 17`. Streaming was visible during generation. |

The conversation was renamed, reloaded, and reopened. All eight messages and their original response model labels remained intact. The saved browser conversation is named **Live four-provider test - 17 October**; it is a local test record, not a conversation shared with other browsers.

Demo mode tests interface behavior only. The recorded test above establishes live provider connectivity and cross-provider recall at the time tested. It does not guarantee future provider availability. An optional 2–3 minute video can show this procedure along with themes and conversation management.

## Checks

```powershell
npm ci
npm run lint
npm run build
npm run test:unit
npm run test:api
```

The API suite targets the deployed application by default. Set `TEST_BASE_URL` only when checking another Vercel deployment. On a protected deployment, it verifies that unauthenticated chat requests are blocked and explicitly skips checks requiring sign-in. It does not bypass authentication or report those skipped checks as passed. On an accessible deployment it checks configuration safety, origin checks, validation, payload limits, and sample streaming. Sample-response tests are skipped when the target is live, so the suite never intentionally spends model credits. The live acceptance test above is separate.

The unit suite checks the real model catalog, saved-history migration, safe provider errors, origins, content types, request size limits, message validation, and the rate limiter without requiring credentials. Node.js 22 type transformation is used for these TypeScript modules; its experimental warnings do not indicate test failures.

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
- Live connectivity and cross-provider recall passed for all four selected models on 17 October 2026. Error mapping and the application rate limiter are tested without deliberately exhausting live credits or forcing an upstream outage. Provider availability and limits can change.
- The GitHub repository is public. The protected live deployment still requires reviewer access approval through Vercel. Deadline: **23 October 2026**.

Review compatible dependency updates instead of using `npm audit fix --force`.
