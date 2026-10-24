# Document development

## Approach

The structured invoice/table extraction milestone adds reviewed JSON/Excel exports and saved extraction context. See [the extraction notes](structured-extraction.md) for limits, validation and setup. The hosted results below describe the earlier upload/retrieval milestone.

Extend the existing chat instead of adding a separate document application. Keep originals private, save stable file references in conversation history, and let the server retrieve relevant text for any selected chat model. Existing image validation and generation remain independent.

The first milestone implements upload → parse → chunk → index → retrieve → answer. Structured extraction was subsequently released. Optional real file generation/editing is implemented in this development source; see [file generation](file-generation.md). Its hosted activation remains separate from local tests. Complete summaries remain a later milestone.

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

Those provider/storage contract checks use synthetic data and mocks. Deployment-stage checks below were performed separately against the hosted services.

## Hosted verification — 23 October 2026

- Applied the reviewed additive migration to the existing Supabase project. Verified the separate document bucket is private with a 20 MB limit, pgvector is installed, and all three document tables use RLS. Anonymous and signed-in browser roles cannot read the tables; the server role can. Existing image storage remains private and unchanged.
- Published the document milestone to the same public Vercel deployment and enabled its production document flag. Public API validation passed five checks; two checks correctly skipped authenticated-deployment and demo-only cases.
- Uploaded synthetic PDF, DOCX, XLSX, and TypeScript files through production signed uploads. Hosted Workflows parsed and embedded every file to ready. Original downloads matched the uploaded bytes; missing-owner and wrong-conversation access were rejected.
- GPT-4.1 Mini and Claude Haiku 4.5 returned the four distinct values with filenames and source locations in the same conversation, without reuploading files after the model switch. This verifies the small-file path; it does not establish exhaustive long-document accuracy.
- Browser check: CSV picker preview, upload, indexing, cited answer, reload, and a follow-up after switching from GPT-4.1 Mini to Claude Haiku 4.5 passed. Existing saved conversations remained available.
- Rechecked all 91 development source hashes without changes and verified all 91 published file hashes against the release copy. No credentials were committed.

## Remaining milestones

1. Verify and activate the optional DOCX/XLSX/PDF/code writers on the hosted deployment, including private download/indexing, storage capacity, and bounded real-model edits. Local generation preserves originals and saves new versions; see the file-generation notes for formatting and size limitations.
2. Add complete multi-stage summaries covering every section, extraction over all relevant chunks, and exact spreadsheet table/range operations. Selected retrieval excerpts must never be presented as exhaustive analysis.
3. Add document deletion/retention, cleanup of failed reservations, stalled-start recovery, and review the initial shared public quotas as usage grows.
4. Finish real file drag/drop and clipboard checks, mixed image/document interactions, mobile/accessibility, and the final chat/image regression pass. Keep preview protection.
5. Exercise larger hosted jobs, failures, cancellation, quota boundaries, and source accuracy across long or complex files. Complete the final README/submission review after these milestones.

## Research references

- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Vercel Workflows](https://vercel.com/docs/workflows) and [Hobby allowances](https://vercel.com/docs/workflows/pricing)
- [OpenRouter embeddings](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request)
- [Supabase RAG permissions](https://supabase.com/docs/guides/ai/rag-with-permissions)
- [unpdf](https://github.com/unjs/unpdf), [mammoth](https://github.com/mwilliamson/mammoth.js), and [ExcelJS](https://github.com/exceljs/exceljs)
