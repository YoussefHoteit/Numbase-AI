# Numbase AI

A multi-model chat application built with Next.js App Router, React, TypeScript, Tailwind CSS 4, and shadcn/ui (Base UI). The Vercel AI SDK streams responses from OpenRouter through server routes. Markdown uses react-markdown with syntax highlighting; next-themes handles appearance. Conversations live in browser storage, while private image files and generation records use Supabase.

Live application: [numbase-ai.vercel.app](https://numbase-ai.vercel.app/).

## Setup

1. Install Node.js 22+, clone the repository, and run `npm ci`. Run `npm run dev` for the local interface; without a provider key it shows labeled demo responses.
2. Reuse the existing GitHub repository and Vercel Hobby project. Set `OPENROUTER_API_KEY` only in Vercel's server environment variables. Never commit keys or prefix secrets with `NEXT_PUBLIC_`.
3. Keep Vercel Authentication enabled and set `NUMBASE_DEPLOYMENT_PROTECTED=true` in Production. This flag acknowledges the separate Vercel access control; it does not implement authentication. Public access is a separate, explicit deployment choice.
4. Images are optional. Reuse the already provisioned private Supabase project and `numbase-images` bucket. Configure server-only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a stable `NUMBASE_SESSION_SECRET` of at least 32 characters. The versioned SQL is in `supabase/migrations/001_private_media.sql`; do not rerun it or create duplicate infrastructure for the existing setup.
5. Set `NUMBASE_IMAGE_GENERATION_ENABLED=true` to allow paid generation, or `false` to keep upload and vision chat without generation. Redeploy after changing environment variables.

Text chat works without media configuration. Images require both private storage and signed sessions in production; unavailable image features return a clear error. Development supports separate local media storage.

Verify with `npm run test:unit`, `npm run lint`, and `npm run build`. Detailed test history and HTTP checks are in [docs/testing.md](docs/testing.md).

## Features

- Streaming responses, stop/retry/regenerate, Markdown, tables, highlighted code, and copying.
- Create, search, rename, delete, and reopen conversations; recover interrupted tool requests without losing other chats; light, dark, and system themes; responsive layouts.
- Switch models mid-chat while resending the conversation's text and image context. Earlier replies retain their model labels. Browser history migrates from v1 to v2 while preserving the old recovery copy.
- JPEG/PNG/WebP attachments through the picker, clipboard paste, or drag-and-drop; removable previews, enlargement, vision questions, OCR, and comparisons.
- Optional model-triggered image generation, editing, variations, regeneration, and downloads. Original versions remain available; durable jobs prevent duplicate generation for the same turn and support interrupted-result recovery.
- Server validation, ownership checks, rate limits, private signed uploads, and safe provider errors. Browser history contains stable image references rather than embedded image data or expiring links.

## Models

| Provider | Chat model | OpenRouter ID |
| --- | --- | --- |
| OpenAI | GPT-4.1 Mini | `openai/gpt-4.1-mini` |
| Anthropic | Claude Haiku 4.5 | `anthropic/claude-haiku-4.5` |
| Google | Gemini 2.5 Flash-Lite | `google/gemini-2.5-flash-lite` |
| Mistral | Mistral Small 3.2 | `mistralai/mistral-small-3.2-24b-instruct` |

Optional generation/editing uses `google/gemini-3.1-flash-image` separately from the four chat models.

## Known limitations

- Production currently requires approved Vercel access. This does not meet the assignment’s public, no-login submission requirement.
- Browser-local conversations have no account sync. Clearing cookies or rotating the session secret removes access to that anonymous session's images. Deleting a chat does not yet delete stored files.
- History is limited to 100 messages/64,000 characters; output to 4,096 tokens. Automatic trimming is not implemented. Slow image/tool requests can time out.
- Four attachments per message, 5 MB/20 megapixels each; twelve image-bearing parts per request. No animated images, SVG, video, or masked inpainting. Vision/OCR can be inaccurate.
- Production generation reserves at most five jobs per session/day and twenty globally/day; these are operation limits, not currency caps. Failed or uncertain jobs count and have no automatic paid retry.
- Text rate limiting is per process. Requests use the configured key’s credits; generation has shared daily quotas, but these are not a currency spending cap. Provider availability, credits, key expiry, and Supabase free-tier limits still apply. Demo mode performs no real image analysis or generation.
