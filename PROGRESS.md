# Progress log

## Handoff (24 Oct 2026, 17:00) - read this first

Repo: `G1NYU/harbor-plugins`, branch `main`. Everything is deployed to GitHub Pages by `.github/workflows/deploy.yml` (typecheck, build, validate, update gate, deploy). Deploys take roughly 5-20 minutes. Harbor keeps stale copies, so after a push: remove the repo, reinstall the source, and check the version/name marker.

Deploy rules (since `a2067a9`): a running deploy is no longer cancelled by a newer push (`cancel-in-progress: false`; queued pushes wait, only the newest queued one runs), and pushes that only touch `*.md` files do not start a deploy.

Key files:

- `scripts/prune-repo.ts`: decides what is published. It holds `ORDER`, `KEEP` (main repo), `EXTENDED`, `TESTING` (testing repo), `DEBUG_SKIP`, `SHIM_PUBLISHED`, the `globalThis` shim, the Atsumaru cover fix, the debug wrapper, interceptor support, the cover-host contact snippet and the "Atsumaru (cover debug)" copy.
- `public/index.html`: the pages site, including the Known issues card.
- `plugins/manga/probe/`: the Probe diagnostic plugin (`manifest.json` + `index.ts`).
- `plugins/manga/asura-seanime/`: native Harbor port of Pal's Seanime Asura Scans provider (testing only).
- `PROGRESS.md`: this file.

Repos on the pages site: `manga/repo.json` (main, 38 sources), `manga/repo-extended.json` (main + BatCave + Royal Road), `manga/repo-testing.json` (Probe, Asura Scans (Seanime port), Mangasushi, Asura Scans (Kodama), Atsumaru (cover debug)).

Latest commits, newest first:

- (this commit) Asura Scans (Seanime port) test plugin; docs for the Seanime and Mangayomi findings.
- `771b83f` Kagane removed from the testing repo.
- `7533fb6` PROGRESS.md: Seanime and Mangayomi research, Kagane decision.
- `aff05f8` PROGRESS.md: Probe 0.0.6 results, deploy fix, final Discord report.
- `a2067a9` CI: deploys are no longer cancelled by newer pushes; markdown-only pushes skip the deploy.
- `01cf190` Handoff notes in PROGRESS.md.
- `19a84ff` Probe 0.0.6: header-combination test for cover requests.
- `1482ee1` Probe 0.0.5 (titles end in "+T") and the Atsumaru debug copy contacting cover hosts (`[dbg.i3]`).
- `64b3ad9` PROGRESS.md: cover investigation and the report text.
- `b5b94e8` Probe 0.0.4: five labelled covers.
- `5fdac30` Mangapill removed from the main repo.

### Open problem 1: the Probe in Harbor was stale (cause found, mostly solved)

Cause: the workflow had `cancel-in-progress: true` and the update gate makes a deploy take 10-20 minutes. Pushes about 10 minutes apart (10:42, 10:53, 11:02, 11:11, 11:20) cancelled each other, so the last build to finish was Probe 0.0.4. This is an inference (the Actions runs were not inspected from here), but the workflow file and the push times fit it. Fixed in `a2067a9`.

After the `a2067a9` deploy went green, the new Probe 0.0.6 rows appeared in Harbor. The five old 0.0.4 cards ("A wikimedia direct" ... "E thunderscans direct", no "+T") still showed next to them. The 0.0.6 source cannot produce those cards, so they come from a stale copy in Harbor. If it matters, remove the testing repo and re-add it; if the old cards return, put the version in Probe's name.

### Open problem 2: grid covers (Atsumaru, Mangapill)

See the cover investigation below. Probe 0.0.6 result (read from the cards in Harbor, `A` = Atsumaru cover, `W` = Wikimedia thumbnail, both fetched with `harbor.http`):

- default: A200 W400
- ref http: A200 W400
- ref https: A200 W400
- ref+origin: A200 W400
- empty UA: A200 W400
- reqwest UA: A200 W400
- accept img: A200 W400
- accept all: A200 W400
- empty ref: A700 W400
- site ref: A200 W400

Reading: the Atsumaru cover loads with 200 under every header setup except an empty Referer (700, not a real HTTP code, probably a Harbor-side error; unexplained). So the header theory is not supported: if the grid card gets a 400, it comes from Harbor's own image request, not from headers a plugin can set. The Wikimedia URL returns 400 in every setup, including default, so it is a bad control (Wikimedia often rejects requests with a missing or generic User-Agent; not verified). The status was checked, not the response body.

The Discord report was posted; no reply from Harbor's developers as of 24 Oct 16:13. Parked for now.

Working agreements: every push to the repo needs the user's confirmation first; cards in Harbor cut text after about 35 characters, so debug output is split into short rows that must be read in order.

### Open problem 3: Asura Scans (Seanime port), untested

The port is in the testing repo as "Asura Scans (Seanime port)" (`asura-seanime`, v0.0.1). It is a native plugin, so it has no `[dbg.i3]` marker; it shows errors as short rows itself (`ERR popular`, `NO PROPS`, `EMPTY popular`, `ERR chapters`). What to check in Harbor, in this order:

1. Popular list: does it show series (it reads `asurascans.com/browse`, first page only)? If it shows `NO PROPS`, the site's Astro markup changed or `/browse` without a search term is not what the page uses.
2. Covers: do they show in the grid? (Cover URLs come straight from the `cover` field of each series.)
3. Series page: title, cover and description come from the page's `og:` tags. Chapter list: from `/comics/<slug>/chapter/<n>` links.
4. Reader: page URLs come from the `ChapterReader` props. Pal's version sends `Referer: https://asurascans.com` with every page image. Harbor cannot attach headers to images, so the reader may fail if the image host checks the Referer.

Not copied from Pal's version: nothing is cached; no pagination beyond the first page.

## 24 Oct 2026 - details

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
- Harbor can also install Mangayomi extension repos (user report, see the Mangayomi section below).

### Cover investigation (Atsumaru, Mangapill)

Symptom: the browse grid shows the placeholder gradient instead of a cover, while chapters, details and reader pages work.

What was found and tried:

1. Atsumaru lists four image variants per series. `image` is a JPEG (about 110-140KB); `smallImage`, `mediumImage` and `largeImage` are AVIF files. The upstream code used `mediumImage` first, so the published bundle now prefers `image` (`ATSUMARU_COVER_RE`; version `1.0.0-alpha.25.1`). The plugin now returns JPEG links on `cdn.atsu.moe/static/posters/...`.
2. Probe fetched those covers from inside Harbor with `harbor.http`: default headers, with a referer, and with referer plus a browser user agent all returned 200 with an image. Probe 0.0.6 repeated this with ten header setups (see open problem 2): all 200 except an empty Referer. Headers set by a plugin are not the problem.
3. The "Atsumaru (cover debug)" copy in the testing repo returned the same JPEG links through the public image proxy `wsrv.nl` (300px JPEG): still a gradient.
4. Probe 0.0.4 returned five labelled series with different covers: A a Wikimedia JPEG (direct), B the same image via the proxy, C an Atsumaru cover (direct), D the same via the proxy, E a Thunderscans image found on its home page. Only E drew (a small site logo, upscaled and pixelated). A, B, C and D were gradients.
5. Probe 0.0.5 and the debug copy downloaded each cover (or one per image host) with `harbor.http` before returning the list, in case Harbor only draws covers from hosts a plugin has contacted: no change.
6. In Harbor, right-click -> View image on an Atsumaru series first showed the cover (saved as a 1800 x 2700 JPEG, i.e. the full-size original from the series detail data); later the same action gave "image request failed 400". The details page works. There is no "copy image address" option.

Conclusion so far: the plugin returns valid absolute JPEG links, `harbor.http` fetches them with 200 under every header setup tried, but Harbor's own image request for covers seems to be rejected (HTTP 400). So the grid card's request differs from what plugins can send. Mangapill shows the same symptom.

### Discord report for Harbor's developers (posted)

Title:

```
Browse grid shows placeholder instead of cover for some plugins (same image works in details / View image)
```

Body:

```
**Problem**
In the browse grid, covers from some plugin sources never render (placeholder gradient), even though the plugin returns a valid absolute https cover URL and the same image loads elsewhere in Harbor.

**What works**
- Series details page shows the cover
- Chapters and reader pages load fine
- The cover URL fetched with harbor.http returns 200 (image/jpeg)

**What fails**
Affected sources: Atsumaru (covers on cdn.atsu.moe) and Mangapill (covers on a separate image host). Other sources (e.g. Thunderscans, MangaKatana) show covers fine. Right-click -> View image on an Atsumaru card sometimes shows "image request failed 400" (it worked once earlier).

**Tests I ran (diagnostic plugin)**
- 5 series, each with a different cover: Wikimedia JPEG direct, same through an image proxy (wsrv.nl), Atsumaru cover direct, same through the proxy, and a small image scraped from a Thunderscans page. Only the Thunderscans one draws (upscaled, pixelated). The rest stay gradient.
- Downloading each cover once with harbor.http before returning the list made no difference.
- I fetched the Atsumaru cover with harbor.http under 10 header setups (default, Referer http/https, Referer+Origin, empty UA, reqwest UA, Accept image/*, Accept */*, site Referer). All returned 200. Only an empty Referer returned a non-HTTP status (700). So the failure does not depend on headers a plugin can set.

**Question**
What does the grid / View image request send (User-Agent, Referer, Origin, Accept), and is it made by the webview or by the native side? Is there a rule for which cover URLs the grid draws (host, size, content type, redirects)? If it is a bug, I'm happy to test fixes.

Harbor version: ___   OS: ___
```

### Other ecosystems checked (24 Oct 2026, afternoon)

Seanime (`5rahim/seanime`, GPL-3.0 app) and its community index `Bas1874/Seanime-Marketplace`:

- Not installable in Harbor. Providers are small JS/TS classes with `search`, `findChapters` and `findChapterPages`; pages can carry per-page `headers`. There is no popular/latest browse, only title search.
- The marketplace index (`/Marketplace/*.json`) is not copied or re-hosted in this repo. Its README says the data comes from an authorized Discord bot and may only be read from the raw GitHub link. `Main.json` is 306 KB; only its first entries (alphabetical, up to "A") were readable from here.
- Individual extension code is a separate matter: each belongs to its author and needs a licence check before porting.
- `Seanime-contributions/Seanime-Providers` (Pal; moved from `Pal-droid/Seanime-Providers`) is MIT licensed (Copyright (c) 2025 Pal). Keep the MIT notice in ported code. Its `src/manga/` folder has: MangaWorldAdult, animesama, asurascans, atsumaru, fanfox, komiku, kuramanga, lelmanga, mangaball, mangabuddy, mangadot, mangafire, mangafreak, mangahub, mangakatana, manganato, mynimekumanga, ravenscans, taiyo, xcomic. Also `src/anime`, `src/other`, `src/plugins`. Only asurascans and atsumaru were read.
- Pal's asurascans provider is a plain HTML scrape of the site's Astro island props (`BrowseFilters`, `ChapterReader`), about 5 KB, no API, no sign-in, no descrambler. This is what the "Asura Scans (Seanime port)" test plugin is based on.
- Pal's atsumaru provider uses a Typesense search endpoint, `/api/manga/allChapters`, `/api/read/chapter`, and `posterMedium` (else `poster`) as the cover, with a Referer on each page. It does not explain the Harbor cover problem.
- Other Seanime providers seen in search fragments (not read): Mangapill and WeebCentral (Island), AsuraScans (Pal, JS, v1.1.2), nhentai (nnotwen), baozimh (Elisoar111), Mangas.in (branrgx, Spanish).
- Anime torrent, online-stream providers and UI plugins in the index depend on Seanime's own interface and are not useful for a manga reader. No ebook type was seen.

Spanish sources (seen, none tested):

- Seanime marketplace: Mangas.in (author branrgx, TypeScript, "Spanish manga, manhwa, and manhua library").
- Mangayomi `index.json` (Dart "madara" entries, not JS): BarManga, Coco Rip, Emperor Scan, Inmortal Scan (all `es`). These are Dart sources, so they depend on whether Harbor handles that type.

Mangayomi:

- The original `kodjodevf/mangayomi-extensions` repo was archived on 3 Dec 2025. Its JS contributing guide describes `getPopular`, `search`, `getDetail`, `getPageList`, a `Client`, a `Document` parser and crypto helpers.
- `tympanicblock61/mangayomi-extensions` is a fork. Per the user, its `index.json` works as a repo in Harbor, but only Weeb Central works. MangaDot worked once long ago and could not be reproduced, so it does not count.
- JS sources in the fork (`javascript/manga/src`): `en/` comix, kagane, mangadot; `all/` bato, mangafire, weebcentral. Atsumaru, Mangapill, Asura Scans and Mangasushi are not JS sources there. The index also lists Dart "madara" entries (for example Mangasushi, Asura Scans.us) that were not tested.
- Weeb Central is already known to be reachable from Harbor (front page returned 200 in the first Probe test).
- Bato, MangaFire and Comix were not tested in Harbor (user reports they do not work) and their code was not read.

### Debug tooling (testing repo)

Testing repo: `manga/repo-testing.json` on the pages site. Sources in it get a debug wrapper at build time (except ids in `DEBUG_SKIP`: `probe`, `asura-seanime`):

- The name ends in `[dbg.i3]` and the version in `-dbg.i3`, so you can tell Harbor loaded the new build.
- A crash while loading shows as rows starting with `LOAD ERR`, followed by the error and the browser features Harbor lacks.
- A failure while running shows `ERR popular`, `ERR search`, `ERR detail` or `ERR chapters`, the code position (`@line:col`) and the last web request with its status.
- A call that takes longer than 12 seconds shows `TIMEOUT after 12s` with the last request.
- The home list ends with `COVERS: ...` rows showing the first two cover links the plugin returned. Tapping those rows (or any debug row) shows an error; that is expected.
- Interceptor support: testing bundles keep the request/response interceptors that extensions register (the normal bridge drops them) and run them around each request.
- "Atsumaru (cover debug)" is a copy of the published Atsumaru under the id `atsumaru-dbg`; it also downloads one cover per image host before returning a list (`COVER_TOUCH_SNIPPET`).
- Probe (diagnostic) is a plugin that runs a small test from inside Harbor and shows the results as rows. Current test (0.0.6): the header-combination test described above. Idea for 0.0.7: replace the Wikimedia control with an image host that has no User-Agent rule.

### Parked (still in testing, not published)

- Kagane: removed from the testing repo in `771b83f` (not feasible in Harbor). Its first request returned 403 with a 6KB body (`GET /api/v2/genres/list`; earlier `POST /api/v2/sources/list`) and the extension's own interceptors did not change this. The Mangayomi version (`kagane.js` in the fork, notes say "requires cloudflare proxy") sends every request through a user-run Cloudflare-impersonating proxy (default `http://localhost:8080`) and reads chapters through a Widevine EME challenge in a webview plus an integrity token (`/api/integrity`). Harbor's runtime has no webview or EME, so chapters could not open even if Cloudflare were solved. The plugin source folder `plugins/manga/kagane/` is still in the repo. API facts, in case they are useful: host `yuzuki.kagane.to`, browse `POST /v2/search/series`, covers `/v2/image/<id>`.
- Asura Scans (Kodama): comes from Kodama's extension (REST API, account sign-in, tile descrambler). The browse page returns 200 with 230KB, then the parser fails reading `length` of something undefined (code positions around 143:10332). Shows only error cards when selected on its own; it once showed covers briefly in the "All" view. Interceptors did not change this. May be replaced by the Seanime port if that works.
- Mangasushi: the upstream code throws "Unsupported Mangasushi metadata or image URL" on a page that downloaded fine (code positions around 138:19174). It relies on Paperback's own request checks and saved image authorizations, which Harbor's bridge does not provide. Probably not worth porting.

### Next

1. Wait for the deploy of this commit to go green, then remove and re-add the testing repo in Harbor and run the Asura Scans (Seanime port) checks in open problem 3.
2. Wait for Harbor's developers to answer the Discord report (grid-cover rule). If a plugin-side change is needed, apply it to Atsumaru (and possibly bring Mangapill back).
3. If the Asura port works, decide whether to replace the Kodama Asura entry. Other candidates from Pal's repo: mangafire, manganato, mangabuddy (not read).
4. Optional: Probe 0.0.7 with a better Wikimedia control; remove the stale 0.0.4 Probe copy from Harbor; delete the unused `plugins/manga/kagane/` folder.
5. Optional: read `weebcentral.js` in the Mangayomi fork to see how a source that works in Harbor is written, and compare its cover handling with Atsumaru.
6. Once the cover question is settled, remove the "Atsumaru (cover debug)" copy and the cover-contact snippet from `scripts/prune-repo.ts`, and remove the "No covers" item from the pages site if it is fixed.
7. Move the `globalThis` shim into the converter (`shared/adapter/paperback-runtime.ts`).
