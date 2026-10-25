# Numbase AI

A multimodal chat and document workspace built with Next.js App Router, React, TypeScript, Tailwind CSS 4 and shadcn/ui (Base UI). Server routes use the Vercel AI SDK and OpenRouter. Supabase stores private files and pgvector search data; Vercel Workflows processes documents and complete summaries. Conversations stay in browser storage.

Live application: [numbase-ai.vercel.app](https://numbase-ai.vercel.app/) · [GitHub repository](https://github.com/YoussefHoteit/Numbase-AI)

## Setup

1. Use Node.js 22+, run npm ci, then npm run dev. Without an OpenRouter key, chat uses labeled demo responses.
2. Keep OPENROUTER_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and a stable NUMBASE_SESSION_SECRET of at least 32 characters only in Vercel's server environment. Never commit credentials or expose them through NEXT_PUBLIC_.
3. Reuse the existing Vercel Hobby and Supabase projects. SQL migrations in supabase/migrations describe the schema; apply only migrations missing from your database, in order. Migrations 004–005 reuse existing document tables and storage for summaries, file removal/restoration and confirmed permanent deletion. No duplicate bucket is needed.
4. Production uses NUMBASE_PUBLIC_ACCESS_ENABLED, NUMBASE_DOCUMENTS_ENABLED, NUMBASE_EXTRACTION_ENABLED, NUMBASE_FILE_GENERATION_ENABLED, NUMBASE_DOCUMENT_SUMMARIES_ENABLED and NUMBASE_DOCUMENT_LIFECYCLE_ENABLED set to true. Enable NUMBASE_IMAGE_GENERATION_ENABLED when paid image generation is intended. Redeploy after environment changes. Keep previews protected.

Checks: npm run test:unit, npm run lint and npm run build. Detailed implementation and verification notes are in docs/.

## Features

- Streaming chat, Markdown/code rendering, stop/retry, conversation create/search/rename/delete/reopen, themes and responsive layouts.
- Model switching preserves conversation, image and file references. Replies identify their model; interrupted history has recovery handling.
- Image picker, clipboard paste and drag/drop with previews; vision/OCR questions and comparison; model-triggered image creation, reference editing, variations, regeneration and downloads.
- PDF, DOCX, XLSX/CSV, code, text and Markdown parsing. Private originals, background indexing, embeddings, vector search and source citations support file questions and comparisons without sending whole large files in each chat request.
- Complete summaries review every indexed section in background batches, combine the results and retain progress across reloads. Selected verbatim source facts remain separate from generated prose. Selected-section reads and sampled overviews show their coverage.
- Invoice/table extraction uses Zod validation and source quotes, with editable previews and JSON/XLSX downloads. Long files support chosen section ranges.
- Real DOCX, XLSX, PDF and code generation through model tools using docx, ExcelJS and pdf-lib. Edits save separate versions and preserve originals.
- A browser-scoped file manager removes/restores files without erasing chat history. Confirmed permanent deletion reclaims stored-file capacity, removes private bytes and search data, and keeps a minimal history reference.

## Models

| Purpose | Models |
| --- | --- |
| Chat and vision | GPT-4.1 Mini, Claude Haiku 4.5, Gemini 2.5 Flash-Lite, Mistral Small 3.2 |
| Image generation/editing | Gemini 3.1 Flash Image |
| Embeddings | OpenAI text-embedding-3-small |
| Structured extraction | GPT-4.1 Mini |
| Complete summaries | Mistral Small 3.2 |
| File generation/editing | Selected chat model with server-side file writers |

All provider requests go through OpenRouter using the server-only key.

## Known limitations

- Documents: 20 MB, 300 PDF pages, 2 million extracted characters, 50,000 spreadsheet rows/100 columns and 800 index sections. Scanned PDFs need OCR; complex layouts may lose structure. Spreadsheet formulas use saved values and are not recalculated.
- Search and sampled overviews provide excerpts. Complete summaries review all indexed sections but condense details and can contain model mistakes. Parsing omissions still apply. Jobs are capped at $0.50 using conservative request bounds and provider price filters; oversized jobs are rejected before starting. Limits are one new summary per browser/day and two globally/day. Cancellation stops later steps; an in-flight request may still use credits. Failed paid steps are not retried automatically. Explicit resumes reuse completed progress and retain the same cumulative spending cap.
- Extraction handles one invoice or the first coherent table from up to 12 selected sections/32,000 characters, returning at most 40 rows/12 columns. Results state their source coverage. Values and user edits need review; quotes and schemas cannot guarantee semantic correctness. Extraction limits are three requests per browser/day and ten globally/day.
- Generated drafts are limited to 24,000 characters, 100 rows/12 columns and 2 MB. Complete edits require a small source. Original layouts, macros, formulas, embedded objects, comments and signatures are not preserved. PDF script support is limited; unsupported text receives a Word alternative.
- Storage allows five active files per browser, eight historical file references per chat and 25 stored files globally, with five/twenty new uploads per browser/globally each day. Removed files remain private and restorable and count toward shared storage until explicitly deleted permanently. Deletion requires the exact filename; uploaded files must wait 125 minutes for signed upload tickets to expire. A failed cleanup can be retried. Daily upload allowances and the chat reference limit do not reset on removal or deletion. Start a new conversation after eight file references. Search limits are 100 per browser/day and 500 globally/day. Images retain their existing generation and size quotas.
- Conversations have no account sync. Clearing cookies or rotating the session secret removes access to that browser's private files. Existing chat messages remain after file removal; deleting a chat does not delete its stored media.
- Chat has a 100-message/64,000-character request limit and four attachments per message. Provider availability, key allowance/expiry and free hosting/storage quotas also apply.
