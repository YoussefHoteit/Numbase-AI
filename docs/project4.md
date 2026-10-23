# Document development

## Approach

Extend the existing chat instead of adding a separate document application. Keep originals private, save stable file references in conversation history, and let the server retrieve relevant text for any selected chat model. Existing image validation and generation remain independent.

The first milestone implements upload → parse → chunk → index → retrieve → answer. Further milestones add complete summaries, structured extraction, and real generated files. The current release does not claim these later features.

### Libraries and hosting

- `unpdf`: extract PDF text with page references. Scans are detected and reported; there is no silent empty-document success.
- `mammoth`: read DOCX paragraphs without rendering untrusted HTML.
- `exceljs`: preserve worksheet/row context when reading XLSX; saved formula values are read without executing formulas.
- `csv-parse`: handle quoted fields and newlines correctly.
- `yauzl`: validate Office archive entries, expanded sizes, encryption flags, and expected package contents before parsing.
- Existing Zod schemas validate attachment references and metadata. Arbitrary URLs, paths, and embedded document payloads are rejected.
- OpenRouter `openai/text-embedding-3-small` produces 1536-dimensional vectors using the existing server key. Parsing does not depend on native model file support.
- Supabase stores document metadata, chunks, and vectors separately from images. Each lookup verifies the signed browser owner and conversation before searching.
- Vercel Workflows executes bounded parse/index steps independently of the browser. Only owner/file IDs and counts pass through workflow events; extracted text remains in private storage/database records. Step retries and embedding retries are disabled to avoid hidden paid retries.

Private signed uploads avoid Vercel's 4.5 MB function request limit. The document bucket is separate because the existing image bucket has image-specific validation and limits; both use the same Supabase project. Keep production documents disabled until the additive migration and hosted processing have been verified.

## State and recovery

Files progress through pending, queued, processing, ready, or failed. Uploaded references are saved with the user message while indexing continues. A failed or unfinished file does not invalidate the saved conversation schema. Only the request winning the pending-to-queued transition starts a job. Indexed batches checkpoint their progress.

Browser history remains backward-compatible with v2, including existing image tools and recovery behavior. Document references use `/api/documents/<uuid>` and are never treated as images or remote provider URLs. Source excerpts are inserted before the latest question with explicit grounding instructions. All selected files contribute results during comparisons.

## Checks completed for the first milestone

- Existing 77 deterministic chat/image/security/history tests passed after initial integration.
- 11 new parser, large-document, ownership, history, and optional-configuration tests passed.
- 4 new SDK/storage contract tests passed, covering private signed uploads, concurrent queue claims, embedding validation, scoped vector search, and evidence passed to all four chat models.
- The complete deterministic suite passed: 93 tests, no failures or skips. Five additional HTTP checks passed on the isolated preview: foreign-origin/missing-owner rejection and PDF, DOCX, XLSX, and code upload → real Workflow indexing → original-byte download. Concurrent completion requests started one job.
- The synthetic long-document fixture contains over 250,000 words. Its final marker is retrieved without putting the full document into the model request.
- Production build passed with Next.js 16.4.2 and Workflow compilation. Next.js was patched from 16.4.0 after newly reported advisories. ExcelJS's UUID dependency uses the compatible patched CommonJS version; the workbook read/write fixture exercises it.
- Browser preview: real PDF/CSV picker uploads, background parsing/indexing to ready, file cards, model switching, reload preservation, and 390-pixel mobile layout inspected. Chat was explicitly in demo mode; no live AI accuracy claim follows from these UI checks.
- Final lint and production build passed. The production dependency audit reports zero vulnerabilities. The full audit still reports five high-severity development-tool findings through ESLint's `fast-glob`/`micromatch`/`braces` chain; no patched `braces` release was available at verification. No forced downgrade or `audit fix --force` was used. Review the upstream fix before the final release.

All provider/storage contract checks use synthetic data and mocks. No real files, provider credits, production tables, repository branches, or deployments were changed for these tests. Live Supabase migration behavior and hosted Workflow execution still need deployment-stage verification.

## Remaining milestones

1. Add complete multi-stage summaries covering every section, extraction over all relevant chunks, and exact spreadsheet table/range operations. Selected retrieval excerpts must never be presented as exhaustive analysis.
2. Add schema-validated invoice/table extraction with editable previews and JSON/XLSX export.
3. Generate DOCX/XLSX/PDF/code using programmatic file writers. Support edits as new versions and preserve originals; document formatting limitations.
4. Add document deletion/retention, cleanup of failed reservations, stalled-start recovery, and review shared public quotas before enabling production.
5. Finish real file drag/drop and clipboard checks, mixed image/document interactions, accessibility, and live paid-provider verification with a bounded test budget. Verify the same public deployment without login, and keep preview protection.
6. Review/apply the additive migration only after inspecting the existing Supabase schema, bucket settings, and extensions. Verify database constraints, RPC permissions, and owner isolation against a disposable dataset.

## Research references

- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Vercel Workflows](https://vercel.com/docs/workflows) and [Hobby allowances](https://vercel.com/docs/workflows/pricing)
- [OpenRouter embeddings](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request)
- [Supabase RAG permissions](https://supabase.com/docs/guides/ai/rag-with-permissions)
- [unpdf](https://github.com/unjs/unpdf), [mammoth](https://github.com/mwilliamson/mammoth.js), and [ExcelJS](https://github.com/exceljs/exceljs)
