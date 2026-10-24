# Handoff for a new chat (24 Oct 2026, 19:20)

Paste this into a new conversation: "Read HANDOFF.md and then PROGRESS.md in G1NYU/harbor-plugins first (GitHub connector). Then tell me the state in five lines and wait for my pick from the Next list."

## What this project is

`G1NYU/harbor-plugins`: a plugin repository for the Harbor manga reader, published on GitHub Pages. Three manifests: `manga/repo.json` (main), `manga/repo-extended.json` (adds BatCave and Royal Road), `manga/repo-testing.json` (diagnostics). The user (G1NYU) tests everything by hand inside Harbor. The assistant has the GitHub connector only: it can read and push files, but it cannot see GitHub Actions runs, the live Pages site or Harbor.

## Working agreements (keep these)

- Every push needs a confirmation first, with the exact files shown. After the user says yes, push exactly what was shown.
- Code pushes start a full deploy (10 to 20 minutes). Markdown-only pushes do not deploy. Never push twice while a deploy is running unless asked (pushes queue, they no longer cancel each other).
- `push_files` needs the full content of each file. `scripts/prune-repo.ts` is about 18 KB, so avoid touching it when a prefix or an existing set already does the job.
- The user's style: direct, informal, wants short and concrete answers, copy-ready text, no AI fluff, no em dashes. Be honest when something is a guess.
- Harbor cards cut text at about 34 characters, so diagnostic plugins print short rows that the user reads out in order.

## Where things stand

- Published and working: many sources in the main repo. `★ Asura Scans` (`plugins/manga/asura-seanime/`) is pinned first. It is a native port of Pal's MIT-licensed Seanime provider and worked on the first try.
- Known issue: Atsumaru shows no grid covers (Harbor side). A Discord report was posted, no answer as of 16:13. Its header conclusion is wrong (see rule 2 below), a correction is pending.
- Closed with reasons (details in PROGRESS.md): BatCave (Cloudflare 403, cleared cookie does not reach plugin requests), Kagane (needs a proxy and a webview), MangaBuddy (its image hosts refuse requests without a Referer), ReadAllComics, ReadComicsOnline and ZipComic (Cloudflare or unreachable).
- Testing repo after the last deploy: Probe3, Mangasushi, Atsumaru (cover debug). Parked native test plugins stay in the repo as reference (`plugins/manga/mangabuddy-io/`, `plugins/manga/readall-native/`) but are built and then removed from every repo.
- Latest commit when this was written: `a02b293`.

## Rules learned the hard way

1. Harbor keeps stale copies of a plugin under the same id, even after a remove and reinstall and a version bump. A new id gets a fresh file. Testing ids match by prefix in `scripts/prune-repo.ts` (`TESTING_PREFIXES`, `DEBUG_SKIP_PREFIXES`, now only `probe`), so a renamed diagnostic needs no edit there. Put the version in the name.
2. `harbor.http` strips Cookie and Referer (echo test against httpbin.org; `allowCookie` and `allowReferer` as tried did nothing). User-Agent, Origin and Accept are untested.
3. Before porting a site: it must load in a normal browser, answer a plain request from inside Harbor, and its image hosts must answer a plain request too.
4. Cloudflare cannot be solved from a plugin. Harbor opens its own check window, but the cleared cookie is not used for the plugin's later requests.
5. Plain HTML or JSON scrapers port well; big Paperback conversions often do not (no `globalThis`, no `Application.executeInWebView`).
6. Make test plugins fail fast (8 second request limits, hard guard) so an error row shows instead of Harbor's "source did not respond".
7. Seanime's community marketplace index (`Bas1874/Seanime-Marketplace`) must not be copied. Pal's `Seanime-contributions/Seanime-Providers` is MIT, so ports are fine with the MIT notice kept.

## Next, in the order the user liked

1. Post a correction in the Harbor Discord thread. Draft: "Correction to my earlier report: my header test was not valid, harbor.http does not send Referer or Cookie at all (I checked with an echo request). Two questions: (1) which request headers can a plugin send, and what do allowReferer and allowCookie in the host API do? (2) when Harbor opens its Cloudflare check window for a source, is the cleared cookie used for that plugin's later requests?"
2. Spanish sources: Mangas.in (Seanime index, author branrgx) first. Find its repo, check the site loads and the image hosts answer, then port.
3. More candidates from Pal's repo (`src/manga/`): komiku, ravenscans, mangafreak, lelmanga, mangahub, mangaball. None read yet.
4. Optional: paginate Asura's browse page (it shows about 20 of 357 series); test whether User-Agent, Origin and Accept reach the server.
5. Cleanups: delete `plugins/manga/kagane/`; remove the "Atsumaru (cover debug)" copy once the cover question is settled; move the `globalThis` shim into `shared/adapter/paperback-runtime.ts`.

## Where to look

- `PROGRESS.md`: full history, results, the posted Discord report, other ecosystems checked.
- `scripts/prune-repo.ts`: what gets published, plus the test tooling.
- `shared/types/harbor.d.ts`: the host bridge as Harbor documents it. `shared/types/manga.ts`: the plugin interface. `shared/types/ebook.ts`: Harbor also has an eBook plugin type.
- `public/index.html`: the Pages site; only its Known issues card needs editing.
- Best template for a new native plugin: `plugins/manga/asura-seanime/index.ts`.
