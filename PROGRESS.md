# Progress log

## Handoff (24 Oct 2026, 18:45) - read this first

Repo: `G1NYU/harbor-plugins`, branch `main`. Everything is deployed to GitHub Pages by `.github/workflows/deploy.yml` (typecheck, build, validate, update gate, deploy). Deploys take roughly 10-20 minutes and no longer cancel each other (`cancel-in-progress: false`); pushes that only touch `*.md` files do not deploy.

Working agreements: every push needs the user's confirmation first (show the exact files); Harbor cards cut text at about 34 characters, so diagnostics print short rows that are read in order, left to right.

### Rules learned today (read before building anything)

1. **Harbor keeps stale copies of a plugin under the same id.** Bumping the version did not help: Probe 0.0.7 kept running the 0.0.6 code even after a remove and reinstall. A new id (probe2, mangabuddy-io2, ...) gets a fresh file. Testing ids now match by prefix in `scripts/prune-repo.ts` (`TESTING_PREFIXES`, `DEBUG_SKIP_PREFIXES`: `probe*`, `mangabuddy-io*`), so renaming needs no edit there. Put the version in the plugin's name to spot a stale copy.
2. **`harbor.http` strips Cookie and Referer.** Probe 0.0.7 echo test against httpbin.org: Cookie and Referer never arrived, with or without `allowCookie` / `allowReferer` set to a value or a host (the option names exist in `shared/types/harbor.d.ts`, their meaning is unknown). Not yet tested: whether User-Agent, Origin or Accept get through. Consequence: the earlier Probe 0.0.6 header test (every setup returned 200) proved nothing about Referer or Origin, so the sentence "the failure does not depend on headers a plugin can set" in the Discord report is not supported.
3. **A site is only portable if its image host answers a plain request.** Check the cover and page image hosts with a plain request (`diag`-style probe) before writing a port. MangaBuddy failed this check after the whole port was written.
4. **Cloudflare cannot be solved from a plugin.** Harbor can open its own check window, but plugin requests do not get the cleared cookie.
5. **Plain HTML or JSON scrapers port well.** The native Asura Scans port (from Pal's MIT Seanime provider) worked on the first try, where the Paperback conversion never did.

### State of the repos

- `manga/repo.json` (main, about 39 sources): now includes `★ Asura Scans` (`asura-seanime` v0.1.0), pinned first.
- `manga/repo-extended.json`: main + BatCave + Royal Road.
- `manga/repo-testing.json`: Probe3 (diagnostic), MangaBuddy (mangak.io) 0.0.3 (parked), Mangasushi, ReadAllComics, ReadComicsOnline, ZipComic, Atsumaru (cover debug).

Key files: `scripts/prune-repo.ts` (what is published, plus all test tooling), `public/index.html` (the Pages site, Known issues card), `plugins/manga/probe/` (diagnostic plugin; its manifest id changes per round), `plugins/manga/asura-seanime/`, `plugins/manga/mangabuddy-io/`, `shared/types/harbor.d.ts` (the host bridge as Harbor documents it: `http`, `parseHtml`, `extractJson`, `grpc`, `getPreference`), `shared/types/ebook.ts` (Harbor also has an eBook plugin type).

Latest commits, newest first:

- (this commit) docs; Probe3 for the western comic sites.
- `c321e99` MangaBuddy 0.0.3: images through wsrv.nl, `diag` search.
- `04fe791` MangaBuddy 0.0.2 (new id) and prefix matching for testing ids.
- `675bfc1` MangaBuddy 0.0.1 native test plugin.
- `5396119` Probe renamed to probe2 (stale-copy workaround).
- `1ca4e2d` Probe 0.0.7 and three western comic sources in testing.
- `92847b9` Asura Scans moved to the main repo as `★ Asura Scans`; the old Kodama Asura entry dropped.
- `841d5e4`, `b989053` Asura (Seanime port) test plugin and notes.
- `771b83f` Kagane removed from the testing repo.
- `a2067a9` deploy workflow no longer cancels running deploys; markdown-only pushes skip it.
- Earlier on 24 Oct: Probe 0.0.4 to 0.0.6, the Atsumaru debug copy, the `globalThis` shim, Mangapill removed from main (`5fdac30`).

## Results and decisions

### Asura Scans: done

Native port of Pal's MIT Seanime provider (`plugins/manga/asura-seanime/`, MIT notice in the header). Works perfectly in Harbor (user report, 24 Oct 17:05), now in the main repo as `★ Asura Scans`, pinned first. It reads `asurascans.com/browse` (first page only, about 20 of 357 series), series pages from `og:` tags, chapters from `/comics/<slug>/chapter/<n>` links and reader pages from the page's `ChapterReader` props. Possible follow-ups: pagination, a proper description.

### BatCave: not fixable from a plugin

BatCave comes from the Paperback extension `karrot0/KakarotExtension` (`src/Batcave`, v1.8, still built upstream on 16 Oct); it is generated at build time, not stored in this repo (`EXTENDED` set in `scripts/prune-repo.ts`). Probe 0.0.7 (run as probe2): `batcave.biz` returns HTTP 403 with a 5 KB page, with default headers and with a browser User-Agent, and the page is neither the comic list nor the proof-of-work page the upstream code looks for (so the earlier proof-of-work guess was probably wrong; most likely a Cloudflare check). Harbor's check window opens and passes, but the plugin's own requests then still fail. An X post dated 20 Oct also reported a BatCave database outage (single source, not confirmed).

### Kagane: not feasible

Needs a user-run Cloudflare-impersonating proxy (default `http://localhost:8080`) and a Widevine challenge run in a webview to open chapters. Removed from the testing repo in `771b83f`. The folder `plugins/manga/kagane/` is still in the repo and could be deleted.

### MangaBuddy (mangak.io): parked

Native test plugin written from the endpoints used by Pal's MIT Seanime provider and karrot0's Mangak extension (no code copied). Search/popular (`api.mangak.io/titles/search`, popular = empty query: the first try with `q=` empty returned 400; the version without it works), series pages, chapter lists and titles all work in Harbor. Covers and chapter images do not load: both image hosts (`rx.resmk.org` for covers, `rx.qvzrg.org` for pages) answer a plain request with HTTP 403 and a 4 KB HTML page, and the wsrv.nl proxy gets a 404 (it cannot fetch them either). Likely a Referer rule, which Harbor cannot send. It is still listed in the testing repo and can be removed by dropping `mangabuddy-io` from `TESTING_PREFIXES` and `DEBUG_SKIP_PREFIXES` in `scripts/prune-repo.ts`.

### Western comic sources: dead as Paperback conversions, native port unproven

ReadAllComics, ReadComicsOnline and ZipComic (from `karrot0/KakarotExtension`) all fail on opening with `Application.executeInWebView is not a function`; Harbor's bridge has no webview call. The upstream ReadComicsOnline code shows why they need it: the site is behind a Cloudflare check, it even probes its image CDN (`cdn.readcomicsonline.ru`) and treats a 403 there as a Cloudflare challenge, and its search needs a cookie-bound CSRF token. A native port would hit the same walls unless these sites answer plain requests from inside Harbor. Probe3 (this commit) tests exactly that: the home page of each site plus the first cover image, from Harbor.

### Grid covers (Atsumaru, Mangapill)

Atsumaru's `image` JPEG cover links are valid and `harbor.http` fetches them with 200, but the browse grid shows a gradient, and "View image" gave "image request failed 400" once. Mangapill showed the same. Probe 0.0.6 (ten header setups, all 200) is now known to be weak evidence (see rule 2). The Discord report was posted; no reply as of 24 Oct 16:13. Idea for a follow-up post: ask what headers the grid request sends, whether plugins can send Referer or Cookie at all, and whether Cloudflare clearance is shared with plugin requests. New cover angle (unchecked): Asura's cover host and whether Asura's covers draw in the grid.

### Discord report (posted)

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

**Question**
What does the grid / View image request send (User-Agent, Referer, Origin, Accept), and is it made by the webview or by the native side? Is there a rule for which cover URLs the grid draws (host, size, content type, redirects)? If it is a bug, I'm happy to test fixes.

Harbor version: ___   OS: ___
```

(The posted version also contained a bullet saying that ten header setups all returned 200 and concluding that headers are not the cause. That conclusion is not supported, see rule 2.)

## Other ecosystems checked

Seanime (`5rahim/seanime`, GPL-3.0) is not installable in Harbor: providers are JS/TS classes with `search`, `findChapters`, `findChapterPages`, no browse list. Its community index `Bas1874/Seanime-Marketplace` must not be copied or re-hosted (its README forbids it; only read the raw link). Individual extension code is a separate matter: `Seanime-contributions/Seanime-Providers` (Pal, MIT, Copyright (c) 2025 Pal) allows ports with the MIT notice kept. Its `src/manga/` folder: MangaWorldAdult, animesama, asurascans, atsumaru, fanfox, komiku, kuramanga, lelmanga, mangaball, mangabuddy, mangadot, mangafire, mangafreak, mangahub, mangakatana, manganato, mynimekumanga, ravenscans, taiyo, xcomic. Read so far: asurascans (ported), atsumaru, manganato (targets mangabats.com, Referer on every request, title search only), mangabuddy (targets mangak.io), mangafire (needs a three-stage signing function for every API call). Other Seanime providers seen but not read: Mangapill, WeebCentral (Island), nhentai (nnotwen), baozimh (Elisoar111), Mangas.in (branrgx, Spanish). Anime torrent, streaming and UI plugins in the index are not useful for a manga reader; no ebook type was seen.

Mangayomi: the original `kodjodevf/mangayomi-extensions` repo was archived on 3 Dec 2025. The fork `tympanicblock61/mangayomi-extensions` works as a repo in Harbor (user report) but only Weeb Central works; MangaDot worked once and could not be reproduced. Its JS sources: comix, kagane, mangadot, bato, mangafire, weebcentral.

Spanish sources (seen, none tested, not started): Mangas.in (Seanime index, branrgx, TypeScript); Mangayomi Dart entries BarManga, Coco Rip, Emperor Scan, Inmortal Scan (all `es`).

## Debug tooling (testing repo)

`manga/repo-testing.json`. Converted (Paperback) sources in it get a debug wrapper at build time, native ones (ids in `DEBUG_SKIP` / `DEBUG_SKIP_PREFIXES`) show their own error rows:

- Name ends in `[dbg.i3]`, version in `-dbg.i3`.
- `LOAD ERR` rows for crashes while loading; `ERR popular` / `ERR search` / `ERR detail` / `ERR chapters` with the code position and the last web request and status; `TIMEOUT after 12s`.
- `COVERS: ...` rows at the end of the home list.
- Interceptor support (the normal bridge drops the functions).
- "Atsumaru (cover debug)" (`atsumaru-dbg`): a copy of Atsumaru that downloads one cover per image host before returning a list.

## Runtime facts about Harbor

- No usable `globalThis`, `self`, `window` or `document`. Many Paperback 0.9 bundles assign `globalThis.App`; `scripts/prune-repo.ts` runs published bundles with a shim (`SHIM_PUBLISHED`: Thunderscans, MangaKatana, MangaDemon, VortexScans, Atsumaru). TODO: move this into `shared/adapter/paperback-runtime.ts`.
- Native sources (Hijala, ManhwaNex, Asura Scans) never touch `globalThis` and worked from the start.
- Plugins can only hand Harbor bare image links and cannot attach headers to images.
- `harbor.http` strips Cookie and Referer (rule 2). `Application.executeInWebView` does not exist.
- The "All Extensions" view mixes results of every installed source. Share links look like `harbor://detail/manga/<plugin id>::<series id>`. Harbor can install Mangayomi repos.

## Published to the main manga repo

Asura Scans (pinned first), Atsumaru, Hijala, ManhwaNex, Thunderscans, MangaKatana, MangaDemon, VortexScans and the older proven sources. Known issues (also on the Pages site): Atsumaru has no grid covers; VortexScans has chapters from sites that do not open; MangaDemon only opens some chapters. Mangapill was removed (covers).

## Next

1. Read the Probe3 rows (testing repo, "Probe3 western sites"): for each of ReadComicsOnline, ReadAllComics, ZipComic, does the home page load without a Cloudflare page and does the first cover image answer a plain request? Only if both are fine, write a native port for that site (look at the selectors in `karrot0/KakarotExtension` `src/<Site>/main.ts`).
2. Post a short correction and two questions in the Discord thread (what headers plugins can send; whether the cleared Cloudflare cookie reaches plugin requests). Wait for the developers' reply on the grid-cover rule.
3. Spanish sources: read Mangas.in's source (find its repo from the Seanime index), run the image-host check first.
4. Port candidates from Pal's repo that pass the image-host check: komiku, ravenscans, mangafreak, lelmanga, mangahub, mangaball (none read yet). Keep Pal's MIT notice.
5. Cleanups: drop `mangabuddy-io` from the testing prefixes; delete `plugins/manga/kagane/`; remove the stale Probe/Probe2 entries by reinstalling; once the cover question is settled remove the "Atsumaru (cover debug)" copy and the cover-contact snippet; move the `globalThis` shim into the converter.
6. Optional: test whether User-Agent, Origin and Accept reach the server through `harbor.http`; paginate Asura's browse page.
