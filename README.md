# Numbase AI

A chat, image, and document workspace built with Next.js App Router, React, TypeScript, Tailwind CSS 4, and shadcn/ui (Base UI). The Vercel AI SDK streams OpenRouter responses through server routes. Supabase stores private media and document search data; conversations remain in browser storage.

Live application: [numbase-ai.vercel.app](https://numbase-ai.vercel.app/). Project 4 includes document questions, structured extraction, and file generation/editing. Feature availability follows the server configuration.

## Setup

1. Use Node.js 22+, install with `npm ci`, and run `npm run dev`. Without a provider key, chat responses are clearly labeled demo content.
2. Reuse the existing GitHub repository, Vercel Hobby project, and Supabase project. Store `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a stable `NUMBASE_SESSION_SECRET` of at least 32 characters only in Vercel's server environment. Never commit credentials or use `NEXT_PUBLIC_` for secrets.
3. Production requires `NUMBASE_PUBLIC_ACCESS_ENABLED=true` and production access without Vercel login. Keep previews protected. `NUMBASE_DEPLOYMENT_PROTECTED` describes separately authenticated deployments; it does not implement authentication.
4. Image storage already uses `001_private_media.sql`; do not rerun it or replace the existing bucket. Set `NUMBASE_IMAGE_GENERATION_ENABLED=true` only when paid generation is intended.
5. Documents require `002_private_documents.sql` in the same Supabase project, followed by `NUMBASE_DOCUMENTS_ENABLED=true` and a redeployment. Review existing objects before applying it. This adds separate private document storage, pgvector tables, and quotas. Vercel Workflows runs parsing and indexing jobs. Keep the flag off until storage and hosted indexing have been verified.
6. Structured extraction requires the additive `003_extraction_allowance.sql`, then `NUMBASE_EXTRACTION_ENABLED=true`. Review the existing schema before applying migrations once. Extraction is limited to 3 requests per session/day and 10 globally/day.
7. File generation/editing reuses document storage; set `NUMBASE_FILE_GENERATION_ENABLED=true` after verifying the deployed writers and available document quota. No additional migration is required.

Verify with `npm run test:unit`, `npm run lint`, and `npm run build`. Development notes and remaining Project 4 work are in [docs/project4.md](docs/project4.md); earlier verification is in [docs/testing.md](docs/testing.md).

## Features

- Streaming chat, Markdown/code rendering, stop/retry, model switching with conversation context, and per-response model labels.
- Create, search, rename, delete, and reopen chats; interrupted-history recovery; responsive layouts and light/dark/system themes.
- Private image uploads, vision/OCR questions, comparison, model-triggered image generation, editing, variations, regeneration, and downloads.
- Project 4 foundation: PDF, DOCX, XLSX, CSV, code, text, and Markdown attachments; private originals; processing cards; source locations; chunking; OpenRouter embeddings and scoped document retrieval. File references remain in history across reloads and model changes.
- Structured invoice/table extraction with Zod validation, original evidence, editable previews, and JSON/Excel downloads. Save reviewed results in the conversation to keep them across reloads and model switches. Downloads do not call a model again.
- Optional model-triggered DOCX, PDF, XLSX, and code downloads using `docx`, `pdf-lib`, and ExcelJS. Edits create separate versions; originals are preserved. Generated file cards and context remain across reloads/model switches.

## Models

| Purpose | Model |
| --- | --- |
| Chat / vision | OpenAI GPT-4.1 Mini |
| Chat / vision | Anthropic Claude Haiku 4.5 |
| Chat / vision | Google Gemini 2.5 Flash-Lite |
| Chat / vision | Mistral Small 3.2 |
| Image generation / editing | Google Gemini 3.1 Flash Image |
| Document embeddings | OpenAI text-embedding-3-small through OpenRouter |
| Structured extraction | OpenAI GPT-4.1 Mini through OpenRouter |
| File generation / editing | Selected chat model through OpenRouter; server-side file writers |

## Known limitations

- Project 4 is incomplete: full-document summaries, deletion/retention, and final interaction/large-file checks remain. Retrieval provides selected excerpts, not an exhaustive review or exact spreadsheet totals.
- Generated files are bounded to 24,000 draft characters, 100 rows/12 columns, and 2 MB. Edits require the complete small source and reconstruct text/tables without preserving original layout or formulas. PDF has limited script support; unsupported text receives a Word alternative. See [file generation notes](docs/file-generation.md).
- Structured extraction handles one invoice or the first table from one ready file, up to 12 sections/32,000 source characters and 40 rows/12 columns. Larger files are rejected for extraction while normal questions remain available. Extracted values require review; schemas and source quotes do not guarantee semantic correctness. Numbers/dates remain text, and quoted evidence does not validate user edits.
- Documents: 20 MB, 300 PDF pages, 2 million extracted characters, 50,000 spreadsheet rows/100 columns, and 800 chunks maximum. Scanned PDFs need OCR; unreadable pages are reported. Complex layouts may lose structure, and spreadsheet formulas use saved values without recalculation.
- Initial production document quotas reserve at most 5 files per session and 25 globally, with 5/20 new files per day respectively. Query limits are 100 per session/day and 500 globally/day. Deletion and automatic expiry are not yet implemented; failed/pending uploads still occupy reservations. Processing failures require a fresh upload. Review these limits before enabling publicly.
- Conversations have no account sync. Clearing cookies or rotating the session secret removes access to the anonymous session's files. Deleting a chat does not delete stored media yet.
- Chat retains the existing 100-message/64,000-character limit. Four attachments per message; images remain limited to 5 MB/20 megapixels each and twelve image-bearing parts per request. Mistral supports five unique images.
- Provider availability, key allowance/expiry, and hosting/storage quotas apply. Image generation remains limited to 5 jobs per session/day and 20 globally/day. No blind paid image retry is performed. Text rate limiting remains per process. Development without a key uses keyword document search and sample chat replies, not real AI answers.
