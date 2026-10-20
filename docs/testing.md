# Testing and implementation notes

## Earlier feature-session results

The following results were recorded by the original implementation session. They are historical evidence, not new checks or a deployed-release guarantee.

### Image operations and limits

- One output per turn, 1K resolution, a fixed image engine, and up to four reference images.
- Edits and variations create new assets while keeping originals. Regeneration reuses the original prompt/reference parameters; it is not pixel deterministic.
- Jobs are reserved before the provider call. A durable owner/conversation/turn key prevents duplicate generation on a repeated request.
- No automatic paid retries. Uncertain provider failures are recorded and block blind retries; they may still have incurred a charge. Successful interrupted jobs can be recovered with **Check image status**.
- Supabase enforces five reservations per browser session per UTC day and twenty globally per UTC day. Failed/uncertain jobs count. These are operation limits, not guaranteed currency spending caps.
- Storage reservations stop at 50 MB per session and 500 MB globally. Local development reservations prevent duplicate turns but do not implement shared daily quotas.
- Repeated references send one pixel payload per unique image. Large images are converted to a WebP preview of at most 2,048 pixels per side for chat analysis; original files remain unchanged for downloads and image generation. Small text may need a closer crop for accurate OCR.

To check the source and build:

```sh
npm run lint
npm run build
npm run test:unit
npm run test:api
```

The API suite targets the deployed URL. Checks requiring sign-in are explicitly skipped when deployment protection is enabled.

`npm run test:memory` separately runs deterministic same-model, cross-model, persistence, and actual SDK payload checks using mocked OpenRouter responses; it needs no key and spends no credits.

`npm run test:unit` also covers image validation, ownership isolation, v1 migration, all four vision payloads, reference/edit/variation mapping, regeneration, native tool calls, idempotency, and Supabase request contracts. Provider calls in these tests are mocked.

With a development server running on port 8806, `npm run test:media-api` checks synthetic-image HTTP upload, validation, private display/download, and ownership rejection. It refuses non-loopback targets.

### Local validation — 20 October 2026

- 58 deterministic tests passed, including original text-memory/model tests, media ownership, compact vision payloads, native tool calls, defaults, selected-version binding, generation races, and interrupted-job recovery contracts.
- The local API regression suite passed five checks; it explicitly skipped deployment-authentication and demo-stream checks that do not apply to the configured development server. Two real-storage HTTP checks passed upload, validation, private display/download, foreign-session rejection, and origin validation.
- Real OCR and cross-model comparison passed with Gemini 2.5 Flash-Lite and Claude Haiku 4.5. Text generation, reference generation, editing, variations, and downloads were exercised with Gemini 3.1 Flash Image through model-triggered tools.
- After a reload and a switch to GPT-4.1 Mini, the same conversation correctly recalled both numbered uploads and compared the generated sunset image with the earlier daytime image.
- A separate live HTTP regression verified that regeneration preserves the selected image version, its original prompt, and its original reference parameters. This caught and fixed a model choosing an older historical version.
- The file picker and image previews were exercised in the browser. Paste and drag/drop handlers share the same upload pipeline; a manual check of those two input gestures remains part of final release testing.

These are local feature checks, not proof of a public production release. Repeat the signed-out and deployment-specific checks after the reviewed Vercel release.

Live acceptance used approximately US$0.45 of the approved US$3 test budget. New image generation was disabled again after testing; saved images, downloads, uploads, and vision chat remain available locally.


## Current standalone review

The reviewed candidate is separate from both original projects. Existing Supabase storage was verified using read requests only: the private bucket, metadata/job tables, and reservation functions were present. No infrastructure was created.

Text chat must remain independent of optional media setup. The regression suite exercises the real chat handler and SDK stream using an injected provider mock; it checks missing storage, missing session secret, image-history rejection, and the production guard without consuming credits.

Run deterministic checks with:

```sh
npm run test:unit
npm run lint
npm run build
```

For local HTTP checks, start an isolated development server with no service credentials and a separate media directory, then set TEST_BASE_URL to its loopback address before running test:api and test:media-api. Never run synthetic upload tests against existing production storage. The media API suite refuses non-loopback targets.

### Final candidate checks — 20 October 2026

- 74 deterministic tests passed, including ten new recovery tests. The real AI SDK streamed unfinished tool arguments (partial enum and UUID), then simulated reload, stop, and tool failure with an unrelated existing chat. Both histories survived. Completed tool calls/results remain strictly validated.
- Recovery tests also cover malformed individual conversations, invalid JSON, an empty damaged entry, a damaged active selection, storage-read errors, and backup quota failure. Hydration preserves the raw workspace. Valid chats load independently; a failed recovery backup disables persistence for that session.
- Nine automated Edge browser checks passed against a disposable, credential-free local preview. Clipboard paste used an actual image ClipboardItem and keyboard paste. Chromium file-drag input delivered file paths through the browser. Observed paste/drop events were trusted and contained files; no JavaScript-dispatched paste/drop events were substituted.
- Attachment removal, four-file limits, unsupported types, text-only sending without a media session, and desktop light/dark layouts passed. Mobile-emulated checks covered image upload, enlargement, reload, switching models with the earlier image in the request, conversation reopening, and system theme changes.
- Viewports 360×740, 390×844, 844×390, and 390×460 passed horizontal-overflow and visible-Send checks. The landscape test found and fixed an inherited 480px minimum application height. These are browser emulations; physical iOS/Android keyboard and file-picker testing was not performed.
- HTTP checks passed: six chat/configuration checks and two upload/display/download/origin/ownership checks. The local server correctly skipped the Vercel Authentication check because it is not a deployed Vercel instance.
- All new checks used synthetic data, mocked providers, demo streams, and disposable local media. No real browser history or existing Supabase objects were touched; no AI credits were spent.

Production build, lint, dependency audit, source preservation, and the final transfer inventory are recorded in the standalone review report. This candidate still needs an approved protected deployment and fresh production media/session checks before release. Browser cookies and local media sessions do not transfer between origins.


### Release configuration — 20 October 2026

The release retains Vercel Authentication at the project owner’s request. Public access remains explicitly disabled unless the separate server flag is deliberately set. Two additional regressions cover optional public access and media readiness; the full deterministic suite now passes 76 tests. Production build, TypeScript, lint, and the production dependency audit also passed for the release copy. The original projects and earlier reviewed candidate remain unchanged.

The public, no-login acceptance criterion remains outstanding while production is protected. Existing private storage is reused; no duplicate Supabase project, bucket, or tables were created.


### Live multimodal acceptance and provider limits

The protected production deployment passed upload, image description/OCR/comparison with Gemini 2.5 Flash-Lite and Claude Haiku 4.5, text/reference generation, editing, variations, regeneration, and original PNG download. Five successful generation jobs and their private asset records were checked: edits/variations targeted the selected version, and regeneration restored the original prompt and reference parameters. All five generated versions survived reload.

A larger history revealed Mistral’s provider limit of five images per request. The application now checks this before making a provider call, explains the limit, and keeps all history for switching to another vision model. The regression suite includes this case and now passes 77 tests.
