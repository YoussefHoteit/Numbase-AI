# Long-document reading

The existing upload workflow parses and indexes supported files in resumable batches. It stores originals privately and sends source excerpts, rather than whole large files, to the selected chat model.

## Reading and summaries

The readDocument tool uses the existing browser owner and conversation checks. The model can request an overview or a specific 1-based index-section range. Index sections can split one page or group spreadsheet rows; they are not page numbers.

- Small overviews include all indexed text when it fits the 12,000-character budget and 48-section output bound.
- Larger overviews sample up to 48 evenly spaced sections, including the first and last. Long sampled sections retain beginning and ending excerpts. The returned coverage explicitly says that this is a sampled overview, not an exhaustive review.
- Focused reads return full text for up to eight consecutive sections. Oversized ranges are rejected with a smaller-range suggestion, rather than silently truncated.
- A turn permits four read attempts and at most 32,000 returned source characters. Budget is reserved before asynchronous storage access so parallel model tool calls cannot bypass it. Tool reads add no embedding or separate summarization requests; normal chat tool steps still use the selected model's allowance.
- Initial search excerpts share a separate 24,000-character budget across all files. Results include section numbers, source locations and filenames. The final bounded chat step is reserved for a written answer.

The interface shows completed coverage and expandable locations. Saved snapshots retain that metadata and omit bulky source text. Later questions reread owned storage; browser-supplied tool output is not replayed as trusted evidence. Partial SDK inputs remain safe during interruption and reload.

## Extraction from long files

Extract data offers a source range. Files exceeding twelve sections require a range. Server validation enforces the exact range, verifies contiguous stored indices and retains original indices for evidence quotes. Existing requests and saved extraction results remain compatible.

The result stores start/end/total section counts and whether the range covers the whole indexed file. This coverage appears in the result panel, saved conversation, JSON export and spreadsheet Read me tab. Row/column truncation is separate from document coverage. Existing quota reservations, strict model output validation and evidence checks remain in place.

## Limits and remaining work

A sampled overview can miss facts. It must not be called an exhaustive summary or used to prove that a fact is absent. Use search and focused reads for detailed questions. Every answer remains subject to model accuracy and parser limits, including missing scanned-page text and saved spreadsheet formula values.

The initial reading stage did not include complete summaries; the completed workflow is described below. Extraction combining arbitrary ranges, exact spreadsheet calculations and arbitrary large-file editing remain outside the supported scope. Source and result limits are explicit.

## Complete summaries and file management

Complete summary runs a durable background workflow with Mistral Small 3.2. Each step reads sixteen complete indexed sections, saves a bounded summary and checkpoints its coverage. Groups of eight section summaries are combined, followed by a final synthesis. The maximum supported 800-section file needs 58 model requests; events contain only IDs, while source notes remain in private document records. All sections are read before a result can become ready. This is full indexed-source coverage, not a guarantee that every fact survives condensation.

A conservative UTF-8 input bound and output-token ceilings enforce a $0.50 job limit. OpenRouter provider price filters cap rates at $0.10/M input and $0.40/M output tokens; requests have no automatic retries. One new job per browser/day and two globally/day use the existing private query ledger. Cancellation and removal invalidate later writes by job ID and revision; an in-flight request may still incur cost. Stalled jobs become failed without silently replaying paid work.

Migration 004 extends the existing query-kind constraint and adds three server-only functions; it creates no bucket or table. Summary progress is stored inside each existing document's private JSON record. New feature flags default off until the migration is verified.

The file manager uses reversible removal. Removed originals remain private, preserve chat references, cannot be searched/downloaded/edited until restored, and free browser active-file slots. A row lock serializes restore/reservation quota checks. The eight-reference chat limit, global stored-file cap and daily upload caps still include removed files, so removal cannot bypass spending/storage guards. There is no automatic permanent purge. Background writes cannot revive removed records. Restoring an interrupted upload marks it failed and requires a fresh upload rather than an implicit retry.

References: [Vercel Workflows](https://workflow-sdk.dev/docs/foundations/workflows-and-steps), [summary model](https://openrouter.ai/mistralai/mistral-small-3.2-24b-instruct).
