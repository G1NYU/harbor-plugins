# Handoff for a new chat (24 Oct 2026, 22:20)

Paste this into a new conversation: "Read HANDOFF.md and then PROGRESS.md in G1NYU/harbor-plugins first (GitHub connector). Then tell me the state in five lines and wait for my pick from the Next list."

## What this project is

`G1NYU/harbor-plugins`: a plugin repository for the Harbor manga reader, published on GitHub Pages. Three manifests: `manga/repo.json` (main), `manga/repo-extended.json` (adds BatCave and Royal Road), `manga/repo-testing.json` (diagnostics). The user (G1NYU) tests everything by hand inside Harbor. The assistant has the GitHub connector only: it can read and push files, but it cannot see GitHub Actions runs, the live Pages site or Harbor. It cannot open most sites either (fetch_url failed on legionscans.com); web search snippets sometimes show a site's URL structure.

## Working agreements (keep these)

- Every push needs a confirmation first, with the exact files shown. After the user says yes, push exactly what was shown. Never put placeholder text in a file argument of a confirmation card.
- Never push a file whose content is a placeholder or a label. After any push that was meant to change content, read every changed file back and compare it with the intended content.
- Code pushes start a full deploy (10 to 20 minutes). Markdown-only pushes do not deploy. `public/index.html` counts as code. Never push twice while a deploy is running unless asked (pushes queue, they no longer cancel each other).
- `push_files` needs the full content of each file. `scripts/prune-repo.ts` is about 18 KB, so avoid touching it when a prefix or an existing set already does the job. Publishing a new source needs one edit there (see rule 10).
- The user's style: direct, informal, wants short and concrete answers, copy-ready text, no AI fluff, no em dashes. Be honest when something is a guess.
- Harbor cards cut text at about 34 characters, so diagnostic plugins print short rows that the user reads out in order.

## Where things stand

- Published and working: many sources in the main repo. `★ Asura Scans` (`plugins/manga/asura-seanime/`) is pinned first. It is a native port of Pal's MIT-licensed Seanime provider and worked on the first try.
- `Legion Scans` (Spanish, legionscans.com, site name Cerberus Series), folder `plugins/manga/legion-es/`, id `legion-scans`, version 0.1.0, second in the main repo. Native plugin written from the site's markup, with branrgx's Cerberus provider as a reference (the repo has no LICENSE file; the user has the author's permission; the header credits him). The user confirmed that the published plugin works, including search. Browse shows the first page of `/wp/manga/` only (31 series); pagination is still open.
- `Atsumaru` works in Harbor, but its browse-grid covers still do not render (same known issue as before). It stays in the main repo. The Pages Known issues card already says its grid covers do not work. No further Atsumaru cover work is planned for now.
- The Pages site (`public/index.html`) was successfully updated, including the Legion lines in the Known issues card.
- The Discord correction about the cover bug was dropped. The user decided not to post it.
- Probe7 is retired: `plugins/manga/probe/` is now a stub with no `harbor.register` call. Kagane is deleted: `plugins/manga/kagane/` no longer exists.
- Manga and manhwa work is closed for now. The next focus is eBooks. First candidate: Z-Library. Firefox addon: https://go-to-library.sk/soft/mozilla-addon-latest.xpi?2 . Example entry: https://z-lib.gd/book/arGojLb0rD/the-love-hypothesis.html?dsource=mostpopular .
- Closed with reasons (details in PROGRESS.md): BatCave (Cloudflare 403, cleared cookie does not reach plugin requests), Kagane (needs a proxy and a webview), MangaBuddy (its image hosts refuse requests without a Referer), ReadAllComics, ReadComicsOnline and ZipComic (Cloudflare or unreachable). Judged not worth porting: Mangas.in (see PROGRESS.md).
- Testing repo after the last deploy: Probe7 (retired stub), Mangasushi, Atsumaru (cover debug). Parked native test plugins stay in the repo as reference (`plugins/manga/mangabuddy-io/`, `plugins/manga/readall-native/`) but are built and then removed from every repo.
- Latest docs commit when this was written: this Markdown-only update, which closed the manga/manhwa phase, recorded the eBook/Z-Library next step and the cleanup checklist.

## Rules learned the hard way

1. Harbor keeps stale copies of a plugin under the same id, even after a remove and reinstall and a version bump. A new id gets a fresh file. Testing ids match by prefix in `scripts/prune-repo.ts` (`TESTING_PREFIXES`, `DEBUG_SKIP_PREFIXES`, now only `probe`), so a renamed diagnostic needs no edit there. Put the version in the name.
2. `harbor.http` strips Cookie and Referer (echo test against httpbin.org; `allowCookie` and `allowReferer` as tried did nothing). User-Agent, Origin and Accept are untested.
3. Before porting a site: it must load in a normal browser, answer a plain request from inside Harbor, and its image hosts must answer a plain request too.
4. Cloudflare cannot be solved from a plugin. Harbor opens its own check window, but the cleared cookie is not used for the plugin's later requests.
5. Plain HTML or JSON scrapers port well; big Paperback conversions often do not (no `globalThis`, no `Application.executeInWebView`).
6. Make test plugins fail fast (8 second request limits, hard guard) so an error row shows instead of Harbor's "source did not respond".
7. Seanime's community marketplace index (`Bas1874/Seanime-Marketplace`) must not be copied. Pal's `Seanime-contributions/Seanime-Providers` is MIT, so ports are fine with the MIT notice kept.
8. Probes must discover, not guess: print the first link paths and image hosts of a page before following a link, because every wrong guess costs a full deploy. Legion needed four probe rounds (Probe4 to Probe7) because the old Cerberus selectors and URL patterns were out of date.
9. Legion facts: the site lives under `/wp/`, series are `/wp/manga/<slug>/`, the catalogue is `/wp/manga/`, chapters are dated posts like `/wp/2024/11/24/103-9/`, the series page has `<li data-num>` rows with `eph-num` links, the reader has a `ts_reader` script with a `sources` JSON, and images come from Jetpack's `i*.wp.com` cache, which answers plain requests.
10. Publishing a source: a new id must be added to `KEEP` and `ORDER` in `scripts/prune-repo.ts`, otherwise it is built and then removed from every repo. Ids that start with `probe` go to the testing repo with no edit and no debug wrapper (native plugins). Test under a `probe...` id first, then publish under a clean new id.
11. Never push a file whose content is a placeholder or a label. After a push that was meant to change content, read the file back and verify the real content arrived.

## eBook phase (next)

Manga and manhwa are done for now. The next project is eBooks.

First candidate: Z-Library.

- Firefox addon download: https://go-to-library.sk/soft/mozilla-addon-latest.xpi?2
- Example book entry: https://z-lib.gd/book/arGojLb0rD/the-love-hypothesis.html?dsource=mostpopular

First questions to answer before writing any plugin:

1. What does the Firefox addon actually do (search, mirrors, login, download links)?
2. Which Z-Library mirror/domain is stable for the user, and does it need login?
3. What does a book page expose without JavaScript: title, author, cover, formats, download links?
4. Does Harbor's eBook plugin type (`shared/types/ebook.ts`) support search, details and downloads in the way Z-Library needs?
5. Are downloads direct files, or do they need a session/interstitial page?

Do not write a plugin until these are checked. Probe first, then build.

## Cleanup checklist

- Delete `plugins/manga/probe/` (retired Probe7 stub).
- Delete `plugins/manga/mangabuddy-io/` (parked native test plugin).
- Delete `plugins/manga/readall-native/` (parked native test plugin).
- Keep `plugins/manga/example-manga/` unless the user says otherwise.
- Keep Atsumaru in the main repo; it works, but its grid covers do not render and this is already annotated on the Pages site.
- Later, optional: move the `globalThis` shim from `scripts/prune-repo.ts` into `shared/adapter/paperback-runtime.ts`.

## Next, in the order the user liked

1. Cleanups after user approval: delete `plugins/manga/probe/`, `plugins/manga/mangabuddy-io/`, `plugins/manga/readall-native/`.
2. eBook research: Z-Library addon, mirrors, book-page structure, Harbor eBook plugin type, download flow.
3. Later, optional: move the `globalThis` shim into `shared/adapter/paperback-runtime.ts`.

## Where to look

- `PROGRESS.md`: full history, results, the posted Discord report, other ecosystems checked, the Legion probe results.
- `scripts/prune-repo.ts`: what gets published, plus the test tooling.
- `shared/types/harbor.d.ts`: the host bridge as Harbor documents it. `shared/types/manga.ts`: the plugin interface. `shared/types/ebook.ts`: Harbor also has an eBook plugin type.
- `public/index.html`: the Pages site; its Known issues card is updated.
- Best templates for a new native plugin: `plugins/manga/asura-seanime/index.ts` (data embedded in the page) and `plugins/manga/legion-es/index.ts` (WordPress theme scraped with regex).
