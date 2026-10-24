# Progress log

## Handoff (24 Oct 2026, 23:00) - read this first

Repo: `G1NYU/harbor-plugins`, branch `main`. Everything is deployed to GitHub Pages by `.github/workflows/deploy.yml` (typecheck, build, validate, update gate, deploy). Deploys take roughly 10-20 minutes and no longer cancel each other (`cancel-in-progress: false`); pushes that only touch `*.md` files do not deploy.

Working agreements: every push needs the user's confirmation first (show the exact files); never push placeholder content; after a content push, read the files back to verify them. Harbor cards cut text at about 34 characters, so diagnostics print short rows that are read in order, left to right.

### Rules learned (read before building anything)

1. **Harbor keeps stale copies of a plugin under the same id.** Bumping the version did not help: Probe 0.0.7 kept running the 0.0.6 code even after a remove and reinstall. A new id (probe2, mangabuddy-io2, readall-native2, ...) gets a fresh file. Testing ids can match by prefix in `scripts/prune-repo.ts` (`TESTING_PREFIXES`, `DEBUG_SKIP_PREFIXES`, currently only `probe`), so renaming a diagnostic needs no edit. Put the version in the plugin's name to spot a stale copy. A stale repo list in Harbor also makes installs of removed entries fail: remove and re-add the repo.
2. **`harbor.http` strips Cookie and Referer.** Probe 0.0.7 echo test against httpbin.org: Cookie and Referer never arrived, with or without `allowCookie` / `allowReferer` set to a value or a host (the option names exist in `shared/types/harbor.d.ts`, their meaning is unknown). Not yet tested: whether User-Agent, Origin or Accept get through. Consequence: the earlier Probe 0.0.6 header test (every setup returned 200) proved nothing about Referer or Origin, so the sentence "the failure does not depend on headers a plugin can set" in the Discord report is not supported.
3. **A site is only portable if its image host answers a plain request.** Check the cover and page image hosts with a plain request (`diag`-style probe) before writing a port. MangaBuddy failed this check after the whole port was written. Also check that the site loads in a normal browser first (ReadAllComics did not).
4. **Cloudflare cannot be solved from a plugin.** A plain `harbor.http` request that hits a Cloudflare check makes Harbor open its own check window (seen for readcomicsonline.ru and zipcomic.com), but plugin requests do not get the cleared cookie afterwards.
5. **Plain HTML or JSON scrapers port well.** The native Asura Scans port (from Pal's MIT Seanime provider) worked on the first try, where the Paperback conversion never did. Legion Scans, a WordPress theme scraped with regex, also worked.
6. **Make test plugins fail fast.** If a plugin call takes too long Harbor shows "source did not respond" or "aborted" with no detail. Put short timeouts (8 s) and a hard guard around every request so an error row appears instead.
7. **Probes must discover, not guess.** Print the first link paths and image hosts of a page before following a link. Every wrong guess costs a full deploy; Legion needed four rounds (Probe4 to Probe7).
8. **Publishing needs one edit in `scripts/prune-repo.ts`.** A new id must be in `KEEP` and `ORDER`, otherwise it is built and then removed from every repo. Ids starting with `probe` land in the testing repo with no edit and no debug wrapper. Test under a `probe...` id, then publish under a clean new id.
9. **Never push placeholder content.** A file argument must contain the full real content. After a push that was meant to change content, read every changed file back and compare it with the intended content.

### State of the repos

- `manga/repo.json` (main, about 40 sources): includes `★ Asura Scans` (`asura-seanime` v0.1.0) pinned first and `Legion Scans` (`legion-scans` v0.1.0, Spanish) second.
- `manga/repo-extended.json`: main + BatCave + Royal Road.
- `manga/repo-testing.json`: Probe7 (retired stub), Mangasushi, Atsumaru (cover debug).

Key files: `scripts/prune-repo.ts` (what is published, plus all test tooling), `public/index.html` (the Pages site, Known issues card), `plugins/manga/probe/` (retired Probe7 stub), `plugins/manga/asura-seanime/` and `plugins/manga/legion-es/` (published native plugins), `plugins/manga/mangabuddy-io/` and `plugins/manga/readall-native/` (parked native test plugins, built but not in any repo), `shared/types/harbor.d.ts` (the host bridge as Harbor documents it: `http`, `parseHtml`, `extractJson`, `grpc`, `getPreference`), `shared/types/ebook.ts` (Harbor also has an eBook plugin type).

Latest commits, newest first:

- (this commit) docs: confirm BDeBooks as first eBook plugin candidate; include all entries.
- `c4c050d` docs: group Mangapill with Atsumaru cover issue; make eBooks the immediate next step.
- `6c5ba42` docs: close manga/manhwa phase; record eBook/Z-Library next step and cleanup checklist.
- `5abdb39` delete `plugins/manga/kagane/manifest.json`.
- `809c15f` delete `plugins/manga/kagane/index.ts`.
- `2b4bd1c` restore real handoff and progress; retire Probe7.
- `6a4893e` publish Legion Scans as `legion-scans`.
- Earlier commits: see the previous log below.

## Manga and manhwa: closed for now

The manga/manhwa phase is closed. Legion Scans is published and working, including search. Asura Scans is published and working. Atsumaru works, but its browse-grid covers still do not render; it stays in the main repo and the Pages Known issues card already says its grid covers do not work. Mangapill had the same browse-grid cover issue and was removed from the main repo because of it. No further cover work is planned for now.

## Next: eBooks (BDeBooks)

The next focus is eBooks. First candidate: BDeBooks, confirmed feasible by probe.

- Search: `https://bdebooks.com/en/search/`
- Book detail: `https://bdebooks.com/en/books/<slug>/`
- Chapters: `https://bdebooks.com/en/books/<slug>/read/` (Contents page)
- Chapter content: `https://bdebooks.com/en/books/<slug>/read/?chapter=<n>`

Probe findings:

- Chapter pages are server-rendered HTML, not a JavaScript-only shell.
- Chapter text is in simple `<h4>` (chapter title) and `<p>` (paragraphs) tags, so `content(chapterId)` can parse it directly.
- Chapters link to each other with `rel="prev"` and `rel="next"`, and the reader tracks progress.
- The Contents page at `/read/` lists chapters and links to `?chapter=n`.
- User decision: include all entries, not public-domain-only. BDeBooks is community shared from one person to another.

Z-Library was checked and parked: login, rotating/personal domains, CAPTCHA, download-first model, and Harbor's eBook plugin type has no download-file hook, so it does not fit.

## Cleanup checklist (deferred)

Not part of the current eBook phase. Do only if the user asks.

- Delete `plugins/manga/probe/` (retired Probe7 stub).
- Delete `plugins/manga/mangabuddy-io/` (parked native test plugin).
- Delete `plugins/manga/readall-native/` (parked native test plugin).
- Keep `plugins/manga/example-manga/` unless the user says otherwise.
- Keep Atsumaru in the main repo; it works, but its grid covers do not render and this is already annotated on the Pages site.
- Later, optional: move the `globalThis` shim from `scripts/prune-repo.ts` into `shared/adapter/paperback-runtime.ts`.

## Results and decisions

### Asura Scans: done

Native port of Pal's MIT Seanime provider (`plugins/manga/asura-seanime/`, MIT notice in the header). Works perfectly in Harbor (user report, 24 Oct 17:05), in the main repo as `★ Asura Scans`, pinned first. It reads `asurascans.com/browse` (first page only, about 20 of 357 series), series pages from `og:` tags, chapters from `/comics/<slug>/chapter/<n>` links and reader pages from the page's `ChapterReader` props. Possible follow-ups: pagination, a proper description.

### Legion Scans (Spanish): done, published, working

Site: legionscans.com, shown as Cerberus Series, a WordPress comics theme under `/wp/`. Reference: `branrgx/seanime-extensions`, `src/CerberusSeries/main.ts` (no LICENSE file in that repo; the user has the author's permission; the plugin header credits him). The old provider's selectors and URL patterns were partly out of date, so the plugin was written from probe results.

Probe results (all with plain `harbor.http` requests, user-read rows):

- Probe4: home `/` and `/wp/` both 200, 228KB (same page). Series link regex found nothing. First image on the page is on `sp-ao.shortpixel.ai` (200).
- Probe5: 132 internal links on the home page; nav links are `/wp/`, `/wp/marcador/` (bookmarks), `/wp/az/`, `/wp/blog/`. 49 images, hosts ShortPixel and Jetpack (`i0.wp.com`, `i3.wp.com`), all 200. The probe followed `/wp/marcador/` by mistake.
- Probe6: `/wp/az/` is a filter page (`?show=A` and so on), the first link was `/wp/comics/` (latest updates). Wrong follow again.
- Probe7: `/wp/manga/` 200, 191KB, 31 series links (`/wp/manga/<slug>/`). A series page has 107 `eph-num`, 103 `data-num` rows and 103 dated chapter links (`/wp/YYYY/MM/DD/<n>-<id>/`). The chapter page has `readerarea`, `ts_reader`, a `sources` JSON, and its first image is on `i2.wp.com` (200, 248KB). Everything passed.

Plugin: `plugins/manga/legion-es/` (id `legion-scans`, 0.1.0, lang `es`). Browse reads `/wp/manga/` (first page only), search uses `/wp/?s=`, details come from `og:` tags, chapters from `<li data-num>` rows (fallback: dated links), pages from the `images` array of the reader's `ts_reader` JSON (fallback: `#readerarea` images). First published as the test copy `probe-legion1` (commit `d084a22`); the user said it works. Published as `legion-scans` in commit `6a4893e`. The user confirmed the published plugin works, including search.

Open: pagination of `/wp/manga/`.

### Mangas.in (Spanish): not worth porting

The provider (`branrgx/seanime-extensions`, `src/MangasIn/main.ts`) targets `m440.in`. Search is title only (`/search/?q=`). The chapter list depends on a Cloudflare Worker run by the author (`curly-haze-60fa.branrgx.workers.dev`) that decodes an obfuscated string from the series page. Every request sends a Referer, and the repo has no LICENSE file. Dropped in favour of Legion.

### Pal's candidates read so far

From `Seanime-contributions/Seanime-Providers`, `src/manga/` (MIT):

- komiku: Indonesian, `komiku.org`, search on `api.komiku.org` (`/?post_type=manga&s=`), parsed with `LoadDoc` selectors (`div.bge`, `td.judulseries a`, `img.klazy.ww`), page images need no headers. Title search only, no browse list.
- ravenscans: English, `ravenscans.org`, same WordPress theme family as Legion (`div.bsx`, `li data-num`, `#readerarea` with the images inside a `<noscript>` block), Referer sent on page images.
- lelmanga: French, `lelmanga.com`, same theme family, Referer set to the chapter URL on page images.
- Not read: mangafreak, mangahub, mangaball.

### Closed: BatCave, Kagane, MangaBuddy, western comic sites

- **BatCave** (Paperback extension from `karrot0/KakarotExtension`, `src/Batcave`, generated at build time, `EXTENDED` set in `scripts/prune-repo.ts`): `batcave.biz` returns HTTP 403 with a 5 KB page (default headers and browser User-Agent), probably a Cloudflare check. Harbor's check window opens and passes, but the plugin's own requests still fail. Not fixable from a plugin.
- **Kagane**: needs a user-run Cloudflare-impersonating proxy (default `http://localhost:8080`) and a Widevine challenge in a webview. Not feasible. The folder `plugins/manga/kagane/` has been deleted.
- **MangaBuddy (mangak.io)**: native test plugin (`plugins/manga/mangabuddy-io/`, written from the endpoints used by Pal's MIT Seanime provider and karrot0's Mangak extension, no code copied). Search/popular (`api.mangak.io/titles/search`; the version with `q=` empty returns 400, the one without it works), series pages, chapter lists and titles work in Harbor. Covers and chapter images do not: the image hosts (`rx.resmk.org`, `rx.qvzrg.org`) answer a plain request with HTTP 403 and a 4 KB HTML page, and wsrv.nl gets a 404. Likely a Referer rule that Harbor cannot satisfy.
- **Western comic sources** (ReadAllComics, ReadComicsOnline, ZipComic): the Paperback conversions all fail on opening with `Application.executeInWebView is not a function`. Native route: ReadComicsOnline and ZipComic made Harbor open its Cloudflare check window on a plain request (Probe3), so they are Cloudflare-protected. ReadAllComics: upstream is plain HTTP, a native test plugin (`plugins/manga/readall-native/`, 0.0.1 and 0.0.2, MIT notice kept) installed fine but returned nothing, then "source did not respond" / "err popular aborted"; the site does not load in the user's own browser either (down, or blocked by the ISP or network, not determined). Closed.

### Grid covers (Atsumaru, Mangapill)

Atsumaru and Mangapill share the same browse-grid cover issue: cover links can be valid and fetchable with `harbor.http`, but the browse grid shows a gradient instead of the image. Atsumaru stays in the main repo; the Pages Known issues card already says its grid covers do not work. Mangapill was removed from the main repo because of covers. Probe 0.0.6 (ten header setups, all 200) is weak evidence (see rule 2). The Discord report was posted; no reply as of 24 Oct 16:13. The correction was dropped: the user decided not to post it. No further cover work is planned for now.

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

(The posted version also contained a bullet saying that ten header setups all returned 200 and concluding that headers are not the cause. That conclusion is not supported, see rule 2. The planned correction was not posted.)

## Other ecosystems checked

Seanime (`5rahim/seanime`, GPL-3.0) is not installable in Harbor: providers are JS/TS classes with `search`, `findChapters`, `findChapterPages`, no browse list. Its community index `Bas1874/Seanime-Marketplace` must not be copied or re-hosted (its README forbids it; only read the raw link). Individual extension code is a separate matter: `Seanime-contributions/Seanime-Providers` (Pal, MIT, Copyright (c) 2025 Pal) allows ports with the MIT notice kept. Its `src/manga/` folder: MangaWorldAdult, animesama, asurascans, atsumaru, fanfox, komiku, kuramanga, lelmanga, mangaball, mangabuddy, mangadot, mangafreak, mangahub, mangakatana, manganato, mynimekumanga, ravenscans, taiyo, xcomic. Read so far: asurascans (ported), atsumaru, manganato (targets mangabats.com, Referer on every request, title search only), mangabuddy (targets mangak.io), mangafire (needs a three-stage signing function for every API call), komiku, ravenscans, lelmanga. Other Seanime providers seen but not read: Mangapill, WeebCentral (Island), nhentai (nnotwen), baozimh (Elisoar111), Mangas.in (branrgx, Spanish; read, not worth porting), Cerberus Series (branrgx, Spanish; the base of Legion Scans). Anime torrent, streaming and UI plugins in the index are not useful for a manga reader; no ebook type was seen.

Mangayomi: the original `kodjodevf/mangayomi-extensions` repo was archived on 3 Dec 2025. The fork `tympanicblock61/mangayomi-extensions` works as a repo in Harbor (user report) but only Weeb Central works; MangaDot worked once and could not be reproduced. Its JS sources: comix, kagane, mangadot, bato, mangafire, weebcentral.

Spanish sources: Legion Scans is done. Mangas.in is dropped. The Mangayomi Dart entries BarManga, Coco Rip, Emperor Scan and Inmortal Scan (all `es`) are Dart, which Harbor does not run, so they are not usable.

## Debug tooling (testing repo)

`manga/repo-testing.json`. Converted (Paperback) sources in it get a debug wrapper at build time, native ones (ids in `DEBUG_SKIP` / `DEBUG_SKIP_PREFIXES`) show their own error rows:

- Name ends in `[dbg.i3]`, version in `-dbg.i3`.
- `LOAD ERR` rows for crashes while loading; `ERR popular` / `ERR search` / `ERR detail` / `ERR chapters` with the code position and the last web request and status; `TIMEOUT after 12s`.
- `COVERS: ...` rows at the end of the home list.
- Interceptor support (the normal bridge drops the functions).
- "Atsumaru (cover debug)" (`atsumaru-dbg`): a copy of Atsumaru that downloads one cover per image host before returning a list.

## Runtime facts about Harbor

- No usable `globalThis`, `self`, `window` or `document`. Many Paperback 0.9 bundles assign `globalThis.App`; `scripts/prune-repo.ts` runs published bundles with a shim (`SHIM_PUBLISHED`: Thunderscans, MangaKatana, MangaDemon, VortexScans, Atsumaru). TODO: move this into `shared/adapter/paperback-runtime.ts`.
- Native sources (Hijala, ManhwaNex, Asura Scans, Legion Scans) never touch `globalThis` and worked from the start.
- Plugins can only hand Harbor bare image links and cannot attach headers to images.
- `harbor.http` strips Cookie and Referer (rule 2). `Application.executeInWebView` does not exist.
- The "All Extensions" view mixes results of every installed source. Share links look like `harbor://detail/manga/<plugin id>::<series id>`. Harbor can install Mangayomi repos.

## Published to the main manga repo

Asura Scans (pinned first), Legion Scans (Spanish, second), Atsumaru, Hijala, ManhwaNex, Thunderscans, MangaKatana, MangaDemon, VortexScans and the older proven sources. Known issues (also on the Pages site): Atsumaru has no grid covers; VortexScans has chapters from sites that do not open; MangaDemon only opens some chapters; Legion Scans browse shows the first page only. Mangapill was removed (covers).

## Next

1. Build the BDeBooks eBook plugin: search, detail, chapters, content.
2. Later, only if asked: manga cleanups (delete `plugins/manga/probe/`, `plugins/manga/mangabuddy-io/`, `plugins/manga/readall-native/`) and the `globalThis` shim move.
