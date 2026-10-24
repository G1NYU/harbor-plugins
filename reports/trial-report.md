# Trial source report

Run from GitHub Actions (not from your PC), using a stand-in for Harbor. Errors here show what the plugin sees from GitHub's servers. Times are per step. Rows marked control are sources already in the main list.

## Upstreams

| Upstream | Result |
| --- | --- |
| inkdex/extensions | ok, 68 sources |
| PoppingMangoSources/general-extensions-mangago | ok, 28 sources |
| kittycatgit/kitty-extensions-0.9 | ok, 16 sources |
| karrot0/KakarotExtension | ok, 18 sources |
| LucifersCircle/pirate.vodka-extensions | ok, 8 sources |
| itskodama/paperback-extensions | ok, 4 sources |

## Allowlisted but not found in any upstream

none

## Results

| Source | load | popular | search | detail | chapters | pages | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| atsumaru v1.0.0-alpha.25 | ok | ok (20) 0.2s | ok (20) 0.1s | ok 0.1s | ok (496) 0.3s | error: Cannot read properties of undefined (reading 'contentType') 0.0s |  |
| asurascans v1.0.0-alpha.10 | ok | error: Cannot read properties of undefined (reading 'length') 0.4s | error: Cannot read properties of undefined (reading 'length') 0.2s | - | - | - |  |
| hijala v0.0.1-alpha.6 | ok | ok (20) 2.4s | ok (1) 0.2s | ok 0.4s | error: Hijala requires the native SourceManga object. 0.0s | - |  |
| kagane v0.0.1-alpha.18 | ok | error: Request failed with status 403: https://kagane.org/api/v2/sources/list 0.3s | error: Request failed with status 403: https://kagane.org/api/v2/genres/list 0.0s | - | - | - | CF challenge 403 kagane.org/api/v2/genres/list; CF challenge 403 kagane.org/api/v2/sources/list |
| mangademon v1.0.0-alpha.15 | ok | empty 0.3s | empty 0.0s | - | - | - | CF challenge 403 demonicscans.org/index.php; CF challenge 403 demonicscans.org/advanced.php; CF challenge 403 demonicscans.org/search.php |
| mangakatana v1.0.0-alpha.15 | ok | ok (18) 1.7s | ok (9) 0.4s | ok 0.3s | ok (198) 0.3s | ok (18) 0.3s |  |
| mangasushi v0.0.1-alpha.12 | ok | error: Unsupported Mangasushi metadata or image URL. 1.6s | error: Unsupported Mangasushi metadata or image URL. 0.8s | - | - | - |  |
| manhwanex v0.0.1-alpha.6 | ok | ok (20) 0.9s | ok (8) 0.4s | ok 0.1s | ok (12) 0.2s | ok (36) 0.1s |  |
| thunderscans v1.0.0-alpha.11 | ok | ok (6) 0.8s | empty 0.4s | ok 0.6s | ok (54) 0.5s | ok (13) 1.0s |  |
| vortexscans v0.0.1-alpha.13 | ok | ok (48) 0.5s | ok (2) 0.2s | ok 0.8s | ok (264) 0.2s | ok (48) 0.4s |  |
| control: weebcentral v1.0.0-alpha.25 | ok | empty 0.2s | empty 0.0s | - | - | - | CF challenge 403 weebcentral.com/; CF challenge 403 weebcentral.com/search/data |
| control: mangadex v1.0.0-alpha.27 | ok | ok (97) 1.7s | ok (1) 0.5s | ok 0.6s | ok (5) 0.3s | ok (21) 0.3s |  |
| control: mangapill v1.0.0-alpha.12 | ok | ok (10) 0.7s | ok (4) 0.6s | ok 1.0s | ok (405) 1.0s | ok (24) 0.8s |  |
