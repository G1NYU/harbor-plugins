# Trial source report

Run from GitHub Actions (not from your PC), using a stand-in for Harbor. Errors here show what the plugin sees from GitHub's servers.

## Upstreams

| Upstream | Result |
| --- | --- |
| inkdex/extensions | ok, 68 sources |
| PoppingMangoSources/general-extensions-mangago | ok, 28 sources |
| kittycatgit/kitty-extensions-0.9 | ok, 16 sources |
| karrot0/KakarotExtension | ok, 18 sources |
| LucifersCircle/pirate.vodka-extensions (read.pirate.vodka) | FAILED: HTTP 404 for https://read.pirate.vodka/0.9/stable/versioning.json |
| LucifersCircle/pirate.vodka-extensions (github.io) | FAILED: HTTP 404 for https://lucifersCircle.github.io/pirate.vodka-extensions/0.9/stable/versioning.json |
| itskodama/paperback-extensions | ok, 4 sources |

## Allowlisted but not found in any upstream

- hijala
- mangasushi
- manhwanex
- vortexscans

## Results

| Source | load | popular | search | detail | chapters | pages | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| atsumaru v1.0.0-alpha.25 | ok | ok (20) | ok (20) | ok | ok (496) | error: Cannot read properties of undefined (reading 'contentType') |  |
| asurascans v1.0.0-alpha.10 | ok | error: Cannot read properties of undefined (reading 'length') | error: Cannot read properties of undefined (reading 'length') | - | - | - |  |
| kagane v0.2.0 | ok | ok (24) | ok (24) | ok | empty | - |  |
| mangademon v1.0.0-alpha.15 | ok | empty | empty | - | - | - | CF challenge 403 demonicscans.org/index.php; CF challenge 403 demonicscans.org/advanced.php; CF challenge 403 demonicscans.org/search.php |
| mangakatana v1.0.0-alpha.15 | ok | ok (18) | ok (9) | ok | ok (198) | ok (18) |  |
| thunderscans v1.0.0-alpha.11 | ok | ok (6) | empty | ok | ok (54) | ok (13) |  |
