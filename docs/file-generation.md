# File generation and editing

The chat model can call `createFile` to write a real DOCX, PDF, XLSX, or code file. This uses the same OpenRouter chat request; the writers do not call another language model. Enable `NUMBASE_FILE_GENERATION_ENABLED=true` only after reviewing the deployment and storage allowance. The default is off. Existing document storage and migration 002 are reused; no new bucket, table, or migration is required.

## Data flow

1. A selected chat model supplies a bounded, validated file draft through a Vercel AI SDK tool call.
2. `docx`, ExcelJS, or `pdf-lib` writes the file on the server. Code is saved as UTF-8 without execution. The PDF renderer bundles Noto Sans under the included Open Font License.
3. The server claims a deterministic owner/chat/turn ID using the existing document reservation function. It uploads without overwrite into the private `numbase-documents` bucket, saves source chunks and embeddings, then marks the result ready.
4. A chat card shows the format, version, size, download, and an edit action. The download uses the existing owner-protected document route; no public permanent URL is sent to a model.
5. Follow-up models receive the exact saved generated draft from private storage, rather than trusting browser-supplied tool inputs. The file remains searchable through its saved chunks.

The Edit a copy action saves the exact selected file with the user message, so reloads and retries retain the target. The server forces a complete source read first and retains that parent even if the model omits it. For an edit, `readFileForEditing` must load the complete source first. Its owner and conversation must match. Inputs larger than 12 chunks or 24,000 source characters are rejected for a complete edit; they remain available for ordinary retrieval questions. The tool then writes a new document with a parent reference and an incremented version for generated sources. Uploaded originals remain untouched. Edits to original uploads start at version 1 of the derived file.

## Bounds and costs

- One file output per user turn, up to 24,000 serialized draft characters and 2 MB of output.
- Up to 60 paragraphs, or a table with 100 rows and 12 columns. PDF output is capped at 60 pages.
- Existing shared upload reservations apply to both uploads and generated versions: 5 files per session, 25 globally, and 5/20 new files per session/global day. These are capacity limits, not a promise of continuous public availability. Deletion/retention remains a later milestone.
- Indexing calls the existing OpenRouter embedding model once for a bounded batch, with no paid retry. Chat tool loops stop after four steps; file-enabled chat uses no automatic provider retries. Downloads and status checks make no model calls.
- A deterministic turn ID prevents duplicate output reservations across instances. A completed file can be recovered through “Check file status.” If the provider fails after the file is saved, the error explicitly confirms the file remains available. Failed or unfinished reservations are not restarted automatically. A failed file can still occupy storage allowance until lifecycle cleanup is implemented.

## Limitations

Edits reconstruct supported text/table content; they do not preserve an uploaded document's exact layout, styles, formulas, macros, comments, signatures, or embedded objects. XLSX cells are literal strings, including leading zeros and formula-like text; formulas are not evaluated. PDF tables use labeled rows with wrapping and pagination. The bundled PDF font supports Latin, Greek, and Cyrillic; unsupported scripts and complex right-to-left text fail clearly with a Word alternative. DOCX uses the recipient application's available fonts. AI-written content still needs human review. A successful schema is not proof that an edit preserves every intended fact.

## Local verification

The file tests use synthetic content and mocked providers/storage. They cover real file readback, literal spreadsheet cells, long-line PDF pagination, unsupported-script rejection, complete-source edit checks, original-byte preservation, ownership, concurrency, status recovery, quota rejection before embeddings, no paid embedding retry, actual SDK tool calls, and partially streamed arguments alongside an unrelated saved conversation. These checks do not establish live-provider accuracy or a deployed release.

Run `npm run test:files`, `npm run test:unit`, `npm run lint`, and `npm run build`. Before activation, check existing production capacity, bundled-font tracing, hosted private upload/download/indexing, bounded real-model generation/editing, and current allowance. Keep the production key server-only and preserve preview protection.

References: [AI SDK tools](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [docx](https://docx.js.org/), [PDF custom fonts](https://pdf-lib.js.org/docs/api/classes/pdfdocument#registerfontkit), [ExcelJS](https://github.com/exceljs/exceljs), and [Noto fonts](https://github.com/notofonts/noto-fonts).
