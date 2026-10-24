# Progress log

## 24 Oct 2026

### Published to the main manga repo

Atsumaru, Hijala, ManhwaNex, Thunderscans, MangaKatana, MangaDemon and VortexScans. All were tested inside Harbor: series, chapters and page images load.

Removed from the main repo: Mangapill. It worked, but its series covers did not show in Harbor.

Known issues, also listed on the pages site:

- Atsumaru: series show no cover images (placeholder gradient). Series pages, chapters and reader pages load fine. See the cover investigation below.
- VortexScans: some of the sites it pulls from (for example NovelBuddy) show "this chapter could not be loaded from this source".
- MangaDemon: chapters come from several sites and only some of them open.

### What we learned about Harbor's runtime

- Harbor can reach the sites. A diagnostic plugin (Probe) fetched the front pages of MangaKatana, Thunderscans, Atsumaru, VortexScans, Hijala, Weeb Central and Mangapill with Harbor's default headers and every request returned 200.
- Harbor's plugin runtime has no usable `globalThis`, `self`, `window` or `document`. They exist as names but hold nothing.
- Many Paperback 0.9 bundles run `globalThis.App = ...` while loading. In Harbor that threw "Cannot set properties of undefined (setting 'App')", so the plugin never registered and Harbor only showed "the source did not respond". The CI checks run in Node, which has `globalThis`, so they could not catch it.
- Fix: `scripts/prune-repo.ts` runs the upstream bundle as a function bound to its own global-like object (`EXEC_REPLACE` and `CALL_REPLACE`). It is applied to the published bundles that need it (`SHIM_PUBLISHED`: Thunderscans, MangaKatana, MangaDemon, VortexScans, Atsumaru). TODO: move this into `shared/adapter/paperback-runtime.ts` so every converted bundle gets it.
- Pirate Vodka's native sources (Hijala, ManhwaNex) never touch `globalThis`, which is why they worked from the start.
- Harbor's "All Extensions" view mixes results from every installed source, so error cards from one source can sit next to real titles from another.
- Plugins can only hand Harbor bare image links, so they cannot attach headers to images.

### Cover investigation (Atsumaru, Mangapill)

- Probe fetched Atsumaru covers from inside Harbor: headers and referer made no difference (all returned 200). Atsumaru lists four variants per series: `image` is a JPEG (about 110-140KB), while `smallImage`, `mediumImage` and `largeImage` are AVIF files.
- The upstream code used `mediumImage` first. `scripts/prune-repo.ts` now reorders the published bundle to `image ?? mediumImage ?? smallImage` (`ATSUMARU_COVER_RE`) and bumps the version to `1.0.0-alpha.25.1`.
- The debug copy of Atsumaru in the testing repo showed that the plugin now returns JPEG links on `cdn.atsu.moe/static/posters/...`, yet Harbor still shows the placeholder gradient in the series grid. The details page works.
- Mangapill shows the same symptom (everything works except grid covers), so the cause is probably in how Harbor loads grid covers, not in either plugin.
- Experiment in the testing repo: the "Atsumaru (cover debug)" copy sends list covers through the public image proxy `wsrv.nl` (300px JPEG). Names now end in `[dbg.i2]` so you can tell which build Harbor loaded. Result still to confirm.

### Debug tooling (testing repo)

Testing repo: `manga/repo-testing.json` on the pages site. Sources in it get a debug wrapper at build time:

- The name ends in `[dbg.i2]` and the version in `-dbg.i2`, so you can tell Harbor loaded the new build.
- A crash while loading shows as rows starting with `LOAD ERR`, followed by the error and the browser features Harbor lacks.
- A failure while running shows `ERR popular`, `ERR search`, `ERR detail` or `ERR chapters`, the code position (`@line:col`) and the last web request with its status.
- A call that takes longer than 12 seconds shows `TIMEOUT after 12s` with the last request.
- The home list ends with `COVERS: ...` rows showing the first two cover links the plugin returned. Tapping those rows (or any debug row) shows an error; that is expected.
- Cards cut text after about 35 characters, so messages are split into short rows. Read them in order.
- Interceptor support: testing bundles keep the request/response interceptors that extensions register (the normal bridge drops them) and run them around each request.
- Probe (diagnostic) is a plugin that runs a small test from inside Harbor and shows the results as rows. Its current test checks Atsumaru's image fields.

### Parked (still in testing, not published)

- Kagane: loads now, but its first request returns 403 with a 6KB body (`GET /api/v2/genres/list`; earlier `POST /api/v2/sources/list`). Running the extension's own interceptors did not change this. The JSON genre list seen in a popup is most likely Harbor's Cloudflare window showing the response after a manual check. Still to test: solve the popup, then reopen Kagane and see whether Harbor keeps the clearance for plugin requests.
- Asura Scans: comes from Kodama's extension (REST API, account sign-in, tile descrambler). The browse page returns 200 with 230KB, then the parser fails reading `length` of something undefined (code positions around 143:10332). Shows only error cards when selected on its own; it once showed covers briefly in the "All" view. Interceptors did not change this.
- Mangasushi: the upstream code throws "Unsupported Mangasushi metadata or image URL" on a page that downloaded fine (code positions around 138:19174). It relies on Paperback's own request checks and saved image authorizations, which Harbor's bridge does not provide. Probably not worth porting.

### Next

- Confirm the cover-proxy result in Harbor; if grid covers still fail with a plain JPEG from a proxy, ask Harbor's developers how grid covers are loaded.
- Move the `globalThis` shim into the converter.
