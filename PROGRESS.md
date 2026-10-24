# Progress log

## 24 Oct 2026

### Published to the main manga repo

Atsumaru, Hijala, ManhwaNex, Thunderscans, MangaKatana, MangaDemon and VortexScans. All were tested inside Harbor: series, chapters and page images load.

Known issues, also listed on the pages site:

- Atsumaru: series show no cover images. Series pages, chapters and reader pages load fine. The cover links look correct in the code, so the cause is still open (see the Probe test below).
- VortexScans: some of the sites it pulls from (for example NovelBuddy) show "this chapter could not be loaded from this source".
- MangaDemon: chapters come from several sites and only some of them open.

### What we learned about Harbor's runtime

- Harbor can reach the sites. A diagnostic plugin (Probe) fetched the front pages of MangaKatana, Thunderscans, Atsumaru, VortexScans, Hijala, Weeb Central and Mangapill with Harbor's default headers and every request returned 200.
- Harbor's plugin runtime has no usable `globalThis`, `self`, `window` or `document`. They exist as names but hold nothing.
- Many Paperback 0.9 bundles run `globalThis.App = ...` while loading. In Harbor that threw "Cannot set properties of undefined (setting 'App')", so the plugin never registered and Harbor only showed "the source did not respond". The CI checks run in Node, which has `globalThis`, so they could not catch it.
- Fix: `scripts/prune-repo.ts` runs the upstream bundle as a function bound to its own global-like object (`EXEC_REPLACE` and `CALL_REPLACE`). It is applied to the published bundles that need it (`SHIM_PUBLISHED`: Thunderscans, MangaKatana, MangaDemon, VortexScans, Atsumaru). TODO: move this into `shared/adapter/paperback-runtime.ts` so every converted bundle gets it.
- Pirate Vodka's native sources (Hijala, ManhwaNex) never touch `globalThis`, which is why they worked from the start.
- Harbor's "All Extensions" view mixes results from every installed source, so error cards from one source can sit next to real titles from another.

### Debug tooling (testing repo)

Testing repo: `manga/repo-testing.json` on the pages site. Sources in it get a debug wrapper at build time:

- The name ends in `[dbg]` and the version in `-dbg`, so you can tell Harbor loaded the new build.
- A crash while loading shows as rows starting with `LOAD ERR`, followed by the error and the browser features Harbor lacks.
- A failure while running shows `ERR popular`, `ERR search`, `ERR detail` or `ERR chapters`, the code position (`@line:col`, often missing for async errors) and the last web request with its status.
- A call that takes longer than 12 seconds shows `TIMEOUT after 12s` with the last request.
- Cards cut text after about 35 characters, so messages are split into short rows. Read them in order.
- Probe (diagnostic) is a plugin that fetches several sites and shows the status of each as rows.

### Parked (still in testing, not published)

- Kagane: loads now, but its first request (`POST kagane.org/api/v2/sources/list`) returns 403 with a 6KB body, most likely a Cloudflare challenge. Cloudflare also blocked it in CI. Needs a Harbor-side answer on whether its Cloudflare popup can handle POST API calls.
- Asura Scans: comes from Kodama's extension (REST API, account sign-in, tile descrambler). The browse page returns 200 with 230KB, then the parser fails reading `length` of something undefined. Shows only error cards in Harbor.
- Mangasushi: the upstream code throws "Unsupported Mangasushi metadata or image URL" on a page that downloaded fine. It relies on Paperback's own request checks and saved image authorizations, which Harbor's bridge does not provide. Probably not worth porting.

### Next

- Extend Probe to request an Atsumaru cover image with and without a referer, to find out why covers are blank.
- Move the `globalThis` shim into the converter.
