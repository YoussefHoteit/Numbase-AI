# Structured extraction milestone

Extends the document upload/retrieval milestone from `bf6ed7c` with reviewed structured data and downloads.

## How it works

The ready-file card opens an invoice/table extraction panel. The server verifies the signed browser session and conversation, reads every section of a bounded file, reserves one database extraction slot, and calls GPT-4.1 Mini through the existing OpenRouter connection. Vercel AI SDK `Output.object` and Zod enforce the result shape. Provider routing requires support for the schema parameters, and automatic paid retries are disabled.

The server checks each reported quote against its source section and requires each populated value to appear in that quote. This rejects unsupported values and invented citations; it is not a guarantee that the model understood every field correctly. Missing fields stay null. The first invoice or table is extracted rather than silently merging unrelated ones.

For indexed spreadsheet rows, the server can reconstruct evidence from a uniquely matching source row instead of accepting the model's rewritten row formatting. Plain decimal equivalents are restored to the exact source strings. Different rows, fabricated values, locale conversions and ambiguous matches are not silently repaired.

Reviewed values can be edited and exported as JSON or a real Excel workbook. Exports check source-file ownership again, are not cached publicly, and make no model call. ExcelJS receives text values rather than formula or hyperlink objects. Original uploads are unchanged.

Saving adds a schema-validated data part to the existing conversation. Snapshots clone it, recovery accepts it, and both text/vision history conversion include its contents with an explicit user-edit warning. Result data counts toward the existing context budget. The UI leaves room for a follow-up instead of saving a result that would trap the conversation at its limit.

Model context explicitly separates `CURRENT_REVIEWED_VALUES` from `ORIGINAL_SOURCE_EVIDENCE`. Editing a reviewed value does not change the uploaded original. Source quotes and model answers still require human review.

## Deployment prerequisites

- Reuse all existing server-only environment variables and infrastructure.
- Review/apply `003_extraction_allowance.sql` once. It adds a query-kind column and a server-only reservation function to the existing quota table; it creates no new storage bucket.
- Set `NUMBASE_EXTRACTION_ENABLED=true` only after the migration is verified. The reservation fails closed if the function is missing.
- Initial limits: 3 extractions per browser session/day and 10 globally/day; one model call per reserved request, including failures. Exports do not consume extraction slots. The existing anonymous-session limitation remains.
- Verify live invoice/table extraction, quotas and JSON/Excel downloads before treating this milestone as released. Local development uses isolated synthetic fixtures; hosted verification is recorded separately.

## Scope and limits

- One file, 12 sections and 32,000 source characters maximum. Full-source extraction is intentionally separate from top-k retrieval. Large-file extraction and complete summaries remain later work.
- Up to 40 rows, 12 columns and a 24,000-character result. Model-reported omission warnings remain visible and are exported. Overlarge or malformed results fail clearly without being saved.
- Values preserve source formatting; no arithmetic, currency/date normalization or spreadsheet formula execution. Edits retain the original quotes with an explicit warning.
- JSON/XLSX exports cover reviewed extraction data. General AI-authored DOCX/PDF/code files and versioned editing remain a separate milestone.

## Validation

`npm run test:unit` includes the existing regressions plus strict SDK output, source evidence, ownership, whole-file limits, cancellation/no-retry behavior, quota failures, history/context and real workbook checks. `npm run test:extraction` runs the focused suite.

`tests/extraction-api.test.mjs` additionally checks actual HTTP extraction and export routes. It is guarded to run only against an isolated loopback server with an explicitly configured synthetic provider fixture (`EXTRACTION_TEST_FIXTURE=yes`). Never point it at a paid provider configuration.

Browser checks and command results are recorded in the development review beside this working copy. Mocked output verifies integration and UI behavior, not real-model extraction accuracy.

Verified locally on 23 October 2026: 104 deterministic tests, both extraction/export HTTP checks, lint, TypeScript, production build and a zero-finding production dependency audit. Browser checks covered invoice extraction, missing fields, an edited total, an actual Excel download (read back as 1400), saved results after reload, context sent after a model switch, table editing, and a 390-pixel panel with contained table scrolling. Light and dark panels were inspected.

The 24 October release also pins Undici 7.30.1 and deduplicates nested Zod copies to the patched direct dependency. The production audit returned zero findings again, with the regression suite and build repeated after these compatible updates. No forced audit fix or Workflow downgrade was used.

## Hosted release checks — 24 October 2026

- Applied the approved quota migration to the existing database. Both session/global caps were exercised inside a rolled-back transaction; anonymous and signed-in roles cannot execute the reservation function, while the server role can.
- Enabled extraction in Production only and published to the same public Vercel domain. Public API checks passed five tests with two expected skips.
- A real PDF invoice extraction returned the invoice number/total and left missing fields empty. Edited JSON and Excel downloads retained the reviewed total.
- The first live CSV attempt was safely rejected by evidence validation. After source-row grounding was added, a 45-row CSV returned 40 reviewed rows with `truncated=true`, preserved source decimal formatting, and passed edited JSON/Excel download and ownership checks. Claude Haiku distinguished the reviewed 999.00 value from the original 101.00.
- The live browser extracted a text invoice and line items, left its missing due date empty, and downloaded a workbook whose reviewed total was read back as 1300.00. The saved card survived reload. A response that reversed original/reviewed labels prompted the explicit context separation above; source data itself remained intact.
- The deterministic suite now includes 107 passing checks, including source-row integrity, edit direction, and unrelated-conversation preservation. Four extraction-provider requests were used across verification, including the initially rejected CSV result. No paid image generation was repeated.

These are bounded small-file checks, not proof of exhaustive extraction accuracy, scanned-PDF OCR or large-file performance.

## References

- [AI SDK structured output](https://ai-sdk.dev/docs/reference/ai-sdk-core/output)
- [OpenRouter structured outputs and endpoint compatibility](https://openrouter.ai/docs/guides/features/structured-outputs)
