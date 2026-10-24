# Progress log

## 24 Oct 2026

### Published to the main manga repo

Atsumaru, Hijala, ManhwaNex, Thunderscans, MangaKatana, MangaDemon and VortexScans. All were tested inside Harbor: series, chapters and page images load.

Removed from the main repo: Mangapill. It worked, but its series covers did not show in Harbor.

Known issues, also listed on the pages site:

- Atsumaru: series show no cover images in the grid (placeholder gradient). Series pages, chapters and reader pages load fine. This is very likely a Harbor-side issue; see the cover investigation below.
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
- Harbor's share links look like `harbor://detail/manga/<plugin id>::<series id>`.

### Cover investigation (Atsumaru, Mangapill)

Symptom: the browse grid shows the placeholder gradient instead of a cover, while chapters, details and reader pages work.

What was found and tried:

1. Atsumaru lists four image variants per series. `image` is a JPEG (about 110-140KB); `smallImage`, `mediumImage` and `largeImage` are AVIF files. The upstream code used `mediumImage` first, so the published bundle now prefers `image` (`ATSUMARU_COVER_RE`; version `1.0.0-alpha.25.1`). The plugin now returns JPEG links on `cdn.atsu.moe/static/posters/...`.
2. Probe fetched those covers from inside Harbor with `harbor.http`: default headers, with a referer, and with referer plus a browser user agent all returned 200 with an image. Headers are not the problem.
3. The "Atsumaru (cover debug)" copy in the testing repo returned the same JPEG links through the public image proxy `wsrv.nl` (300px JPEG): still a gradient.
4. Probe 0.0.4 returned five labelled series with different covers: A a Wikimedia JPEG (direct), B the same image via the proxy, C an Atsumaru cover (direct), D the same via the proxy, E a Thunderscans image found on its home page. Only E drew (a small site logo, upscaled and pixelated). A, B, C and D were gradients.
5. Probe 0.0.5 and the debug copy downloaded each cover (or one per image host) with `harbor.http` before returning the list, in case Harbor only draws covers from hosts a plugin has contacted: no change.
6. In Harbor, right-click -> View image on an Atsumaru series shows the cover (saved as a 1800 x 2700 JPEG, i.e. the full-size original from the series detail data). The details page works too. There is no "copy image address" option.

Conclusion: the plugin returns valid absolute JPEG links and the images load everywhere else in Harbor, so the grid card's cover rule is the open question. Mangapill shows the same symptom.

### Report for Harbor's developers

> Grid covers don't render for some plugins' `cover` URLs, though the same images load elsewhere in Harbor. Tested with a diagnostic plugin on 24 Oct 2026: of five series with absolute `https` JPEG covers, only one (a small logo from a site the plugin had scraped) is drawn in the browse grid. A Wikimedia JPEG, the same image through an image proxy, and an Atsumaru cover (JPEG, 1800 x 2700, `200 image/jpeg` when fetched with `harbor.http`) all show the placeholder gradient. Right-click -> View image on the Atsumaru series shows the full cover, and the series details page shows it too, so only the grid card fails. Is there a rule for which cover URLs the grid draws (host, size, content type, response headers)? Affected sources: Atsumaru and Mangapill.

### Debug tooling (testing repo)

Testing repo: `manga/repo-testing.json` on the pages site. Sources in it get a debug wrapper at build time:

- The name ends in `[dbg.i3]` and the version in `-dbg.i3`, so you can tell Harbor loaded the new build.
- A crash while loading shows as rows starting with `LOAD ERR`, followed by the error and the browser features Harbor lacks.
- A failure while running shows `ERR popular`, `ERR search`, `ERR detail` or `ERR chapters`, the code position (`@line:col`) and the last web request with its status.
- A call that takes longer than 12 seconds shows `TIMEOUT after 12s` with the last request.
- The home list ends with `COVERS: ...` rows showing the first two cover links the plugin returned. Tapping those rows (or any debug row) shows an error; that is expected.
- Cards cut text after about 35 characters, so messages are split into short rows. Read them in order.
- Interceptor support: testing bundles keep the request/response interceptors that extensions register (the normal bridge drops them) and run them around each request.
- "Atsumaru (cover debug)" is a copy of the published Atsumaru under the id `atsumaru-dbg`; it also downloads one cover per image host before returning a list (`COVER_TOUCH_SNIPPET`).
- Probe (diagnostic) is a plugin that runs a small test from inside Harbor and shows the results as rows. Its current test (0.0.5) returns five labelled covers to see which ones Harbor draws.

### Parked (still in testing, not published)

- Kagane: loads now, but its first request returns 403 with a 6KB body (`GET /api/v2/genres/list`; earlier `POST /api/v2/sources/list`). Running the extension's own interceptors did not change this. The JSON genre list seen in a popup is most likely Harbor's Cloudflare window showing the response after a manual check. Still to test: solve the popup, then reopen Kagane and see whether Harbor keeps the clearance for plugin requests.
- Asura Scans: comes from Kodama's extension (REST API, account sign-in, tile descrambler). The browse page returns 200 with 230KB, then the parser fails reading `length` of something undefined (code positions around 143:10332). Shows only error cards when selected on its own; it once showed covers briefly in the "All" view. Interceptors did not change this.
- Mangasushi: the upstream code throws "Unsupported Mangasushi metadata or image URL" on a page that downloaded fine (code positions around 138:19174). It relies on Paperback's own request checks and saved image authorizations, which Harbor's bridge does not provide. Probably not worth porting.

### Next

- Send the report above to Harbor's developers and wait for the grid-cover rule. If a plugin-side change is needed, apply it to Atsumaru (and possibly bring Mangapill back).
- Once the cover question is settled, remove the "Atsumaru (cover debug)" copy and the cover-contact snippet from `scripts/prune-repo.ts`.
- Move the `globalThis` shim into the converter.
