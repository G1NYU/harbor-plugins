# Progress log

## Handoff (24 Oct 2026, 19:15) - read this first

Repo: `G1NYU/harbor-plugins`, branch `main`. Everything is deployed to GitHub Pages by `.github/workflows/deploy.yml` (typecheck, build, validate, update gate, deploy). Deploys take roughly 10-20 minutes and no longer cancel each other (`cancel-in-progress: false`); pushes that only touch `*.md` files do not deploy.

Working agreements: every push needs the user's confirmation first (show the exact files); Harbor cards cut text at about 34 characters, so diagnostics print short rows that are read in order, left to right.

### Rules learned (read before building anything)

1. **Harbor keeps stale copies of a plugin under the same id.** Bumping the version did not help: Probe 0.0.7 kept running the 0.0.6 code even after a remove and reinstall. A new id (probe2, mangabuddy-io2, readall-native2, ...) gets a fresh file. Testing ids can match by prefix in `scripts/prune-repo.ts` (`TESTING_PREFIXES`, `DEBUG_SKIP_PREFIXES`, currently only `probe`), so renaming a diagnostic needs no edit there. Put the version in the plugin's name to spot a stale copy. A stale repo list in Harbor also makes installs of removed entries fail: remove and re-add the repo.
2. **`harbor.http` strips Cookie and Referer.** Probe 0.0.7 echo test against httpbin.org: Cookie and Referer never arrived, with or without `allowCookie` / `allowReferer` set to a value or a host (the option names exist in `shared/types/harbor.d.ts`, their meaning is unknown). Not yet tested: whether User-Agent, Origin or Accept get through. Consequence: the earlier Probe 0.0.6 header test (every setup returned 200) proved nothing about Referer or Origin, so the sentence "the failure does not depend on headers a plugin can set" in the Discord report is not supported.
3. **A site is only portable if its image host answers a plain request.** Check the cover and page image hosts with a plain request (`diag`-style probe) before writing a port. MangaBuddy failed this check after the whole port was written. Also check that the site loads in a normal browser first (ReadAllComics did not).
4. **Cloudflare cannot be solved from a plugin.** A plain `harbor.http` request that hits a Cloudflare check makes Harbor open its own check window (seen for readcomicsonline.ru and zipcomic.com), but plugin requests do not get the cleared cookie afterwards.
5. **Plain HTML or JSON scrapers port well.** The native Asura Scans port (from Pal's MIT Seanime provider) worked on the first try, where the Paperback conversion never did.
6. **Make test plugins fail fast.** If a plugin call takes too long Harbor shows "source did not respond" or "aborted" with no detail. Put short timeouts (8 s) and a hard guard around every request so an error row appears instead.

### State of the repos

- `manga/repo.json` (main, about 39 sources): includes `★ Asura Scans` (`asura-seanime` v0.1.0), pinned first.
- `manga/repo-extended.json`: main + BatCave + Royal Road.
- `manga/repo-testing.json`: Probe3 (diagnostic, no longer needed), Mangasushi, Atsumaru (cover debug).

Key files: `scripts/prune-repo.ts` (what is published, plus all test tooling), `public/index.html` (the Pages site, Known issues card), `plugins/manga/probe/` (diagnostic plugin; its manifest id changes per round), `plugins/manga/asura-seanime/` (published), `plugins/manga/mangabuddy-io/` and `plugins/manga/readall-native/` (parked native test plugins, built but not in any repo), `shared/types/harbor.d.ts` (the host bridge as Harbor documents it: `http`, `parseHtml`, `extractJson`, `grpc`, `getPreference`), `shared/types/ebook.ts` (Harbor also has an eBook plugin type).

Latest commits, newest first:

- (this commit) testing lists cleaned up; notes.
- `99f10ad`, `a816004` ReadAllComics native test plugin (0.0.1, 0.0.2).
- `55604ad` docs and Probe3.
- `c321e99`, `04fe791`, `675bfc1` MangaBuddy native test plugin (0.0.1 to 0.0.3) and prefix matching for testing ids.
- `5396119`, `1ca4e2d` Probe renamed to probe2; Probe 0.0.7.
- `92847b9` Asura Scans moved to the main repo as `★ Asura Scans`.
- `a2067a9` deploy workflow no longer cancels running deploys; markdown-only pushes skip it.
- Earlier on 24 Oct: Kagane removed from testing (`771b83f`), the Asura Seanime port, Probe 0.0.4 to 0.0.6, the Atsumaru debug copy, the `globalThis` shim, Mangapill removed from main (`5fdac30`).

## Results and decisions

### Asura Scans: done

Native port of Pal's MIT Seanime provider (`plugins/manga/asura-seanime/`, MIT notice in the header). Works perfectly in Harbor (user report, 24 Oct 17:05), in the main repo as `★ Asura Scans`, pinned first. It reads `asurascans.com/browse` (first page only, about 20 of 357 series), series pages from `og:` tags, chapters from `/comics/<slug>/chapter/<n>` links and reader pages from the page's `ChapterReader` props. Possible follow-ups: pagination, a proper description.

### Closed: BatCave, Kagane, MangaBuddy, western comic sites

- **BatCave** (Paperback extension from `karrot0/KakarotExtension`, `src/Batcave`, generated at build time, `EXTENDED` set in `scripts/prune-repo.ts`): `batcave.biz` returns HTTP 403 with a 5 KB page (default headers and browser User-Agent), probably a Cloudflare check. Harbor's check window opens and passes, but the plugin's own requests still fail. Not fixable from a plugin.
- **Kagane**: needs a user-run Cloudflare-impersonating proxy (default `http://localhost:8080`) and a Widevine challenge in a webview. Not feasible. The folder `plugins/manga/kagane/` is still in the repo and could be deleted.
- **MangaBuddy (mangak.io)**: native test plugin (`plugins/manga/mangabuddy-io/`, written from the endpoints used by Pal's MIT Seanime provider and karrot0's Mangak extension, no code copied). Search/popular (`api.mangak.io/titles/search`; the version with `q=` empty returns 400, the one without it works), series pages, chapter lists and titles work in Harbor. Covers and chapter images do not: the image hosts (`rx.resmk.org`, `rx.qvzrg.org`) answer a plain request with HTTP 403 and a 4 KB HTML page, and wsrv.nl gets a 404. Likely a Referer rule that Harbor cannot satisfy.
- **Western comic sources** (ReadAllComics, ReadComicsOnline, ZipComic): the Paperback conversions all fail on opening with `Application.executeInWebView is not a function`. Native route: ReadComicsOnline and ZipComic made Harbor open its Cloudflare check window on a plain request (Probe3), so they are Cloudflare-protected. ReadAllComics: upstream is plain HTTP, a native test plugin (`plugins/manga/readall-native/`, 0.0.1 and 0.0.2, MIT notice kept) installed fine but returned nothing, then "source did not respond" / "err popular aborted"; the site does not load in the user's own browser either (down, or blocked by the ISP or network, not determined). Closed.

### Grid covers (Atsumaru, Mangapill)

Atsumaru's `image` JPEG cover links are valid and `harbor.http` fetches them with 200, but the browse grid shows a gradient, and "View image" gave "image request failed 400" once. Mangapill showed the same. Probe 0.0.6 (ten header setups, all 200) is weak evidence (see rule 2). The Discord report was posted; no reply as of 24 Oct 16:13. Idea for a follow-up post: ask what headers the grid request sends, whether plugins can send Referer or Cookie at all, and whether Cloudflare clearance is shared with plugin requests. Unchecked angle: Asura's cover host and whether Asura's covers draw in the grid.

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

1. Post a short correction and two questions in the Discord thread (what headers plugins can send; whether the cleared Cloudflare cookie reaches plugin requests). Wait for the developers' reply on the grid-cover rule.
2. Spanish sources: read Mangas.in's source (find its repo from the Seanime index). Before writing anything: confirm the site loads in a browser and run the image-host check.
3. Port candidates from Pal's repo that pass those checks: komiku, ravenscans, mangafreak, lelmanga, mangahub, mangaball (none read yet). Keep Pal's MIT notice.
4. Cleanups still open: delete `plugins/manga/kagane/` (and the parked `mangabuddy-io` and `readall-native` folders if they are not wanted as reference); remove the stale Probe/Probe2/Probe3 entries from Harbor by reinstalling the testing repo; once the cover question is settled remove the "Atsumaru (cover debug)" copy and the cover-contact snippet; move the `globalThis` shim into the converter.
5. Optional: test whether User-Agent, Origin and Accept reach the server through `harbor.http`; paginate Asura's browse page.
