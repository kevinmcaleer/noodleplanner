# Pulling the tokens out of Penpot

`npm run design:pull` (#1319) reads the design tokens from the NoodlePlanner
design file in Penpot, writes them over `docs/design/tokens/`, and regenerates
the token block of `visual-system.css`. The **Design tokens** workflow
(`.github/workflows/design-tokens.yml`) runs it on demand and opens a pull
request when something changed. Before this, a design change reached the
repository only if someone remembered to export it by hand.

This page records what the spike found, which route was chosen, and why.

## Three ways to read the tokens

The spike was run on 2026-09-27 against penpot.kevsrobots.com, which reports
version **2.17.2** (`/version.txt`).

### Penpot's RPC API: chosen for the workflow

`GET /api/rpc/command/get-file?id=<file-id>` with
`Accept: application/json` and `Authorization: Token <personal access token>`.

The question the issue asked was whether the token library comes back in a
form that turns back into the DTCG JSON. It does, and no conversion is needed.
In Penpot 2.17.2's source:

- the file's `data.tokens-lib` is a `TokensLib`, and its JSON writer
  (`common/src/app/common/types/tokens_lib.cljc`) is `export-dtcg-json`. That
  is the same function behind Penpot's own *single-file* token export: one
  object keyed by set name, with `$themes` and `$metadata` beside the sets;
- the JSON response writer camel-cases keyword keys only
  (`app.common.json/write-camel-key`), so the token names and `$value` keys
  inside the library arrive untouched, under `data.tokensLib`;
- `get-file` resolves pointer-map fragments on the server for a client that
  does not declare `fdata/pointer-map`, and it checks client features only
  when a client sends some. A plain request gets the whole file.

What the sandbox could not do is fetch a real response. The Claude cloud
sandbox cannot reach penpot.kevsrobots.com (its network policy returns 403),
and from inside the Penpot plugin the endpoint answers `401
authentication-required`, because the plugin's frame does not carry the
session cookie. So the route's shape comes from the source code, and its
tests (`tests/test_design_pull.mjs`) feed `design:pull` a `get-file`-shaped
response built from the committed export. The first real run of the workflow
is the end-to-end check. If Penpot changes the shape, the script stops with
"not a Penpot token library" rather than writing an empty export.

It was chosen because it is the only route that runs unattended. GitHub
Actions and the host can reach Penpot, and a personal access token is an
ordinary repository secret (`PENPOT_ACCESS_TOKEN`).

### The Penpot MCP plugin: for a Claude session

`penpot.library.local.tokens` returns every set, token, type, value and
description, plus the themes and the sets each one enables. It needs the file
open in a browser with the MCP plugin connected, so it suits a Claude session,
not CI.

`npm run design:pull -- --plugin-snippet` prints the code to run with the
plugin's `execute_code`. Save what it returns as a file, then run
`npm run design:pull -- --from that-file.json`. The snippet reads
`token.value`, not `resolvedValue`: the resolved value drops the alpha from a
translucent colour and resolves against the active theme only.

The spike ran the snippet against the design file and compared it with
`docs/design/tokens/`, set by set (a hash over every token's name, type, value
and description):

| set | tokens | before | after |
| --- | --- | --- | --- |
| core | 54 | 52 in Penpot, differs | identical |
| color-light | 130 | 128 in Penpot, differs | identical |
| color-dark | 130 | 128 in Penpot, differs | identical |

The export had drifted ahead of Penpot, which is exactly what this task exists
to stop. #1378 and #1389 added `touch-target`, `touch-field-text`, `qr-ink` and
`qr-paper` to the JSON but not to Penpot. #1378 also rewrote `floating-shadow`
as two shadow layers, and **Penpot cannot hold that**: a layer with a negative
spread is refused ("Spread value cannot be negative"). Penpot keeps the token
as a CSS string, and both forms generate the same CSS. The fix went both ways.
The four tokens were added to Penpot, and the JSON took Penpot's string form
of `floating-shadow`. `visual-system.css` did not change.

### A manual export: the fallback

Tokens → Export → multiple files, over `docs/design/tokens/`, then
`npm run design:tokens`. It needs no code and no token, and it still works.

## What a pull keeps from the committed files

The pull takes every token from Penpot. Three other things in Penpot's JSON are
not design, and taking them from Penpot would put noise in every pull request:

- **Order.** Tokens keep their committed order, because the generator writes the
  CSS in file order and Penpot's order is not the export's. `touch-target`, for
  one, sits after `checkbox-target` in the JSON but at the end of the set in
  Penpot. New tokens go at the end of their set.
- **Theme ids.** A theme's `id` is Penpot's external id, and it changes when the
  file is duplicated or re-imported. The committed export's ids already differ
  from the live file's. A theme that matches by group and name keeps its
  committed id.
- **`$metadata.activeThemes` / `activeSets`.** These record which theme the
  designer last had switched on. The generator reads `$themes.json` instead.

With those three kept, a pull with no design change leaves the tree
byte-for-byte clean. `create-pull-request` then opens nothing, which is the
"no change, no PR" requirement. The tests check this on the committed export.

## What a pull reports

It lists every change token by token: added, changed (with old and new value),
description changed, and **REMOVED**. The workflow puts that list in the pull
request body. Look hard at a removal before merging. It means Penpot does not
have a token the JSON has, and the CSS custom property it generates may still
be in use. Usually the cause is a token added to the JSON and never added to
Penpot, which is the drift described above.

## Setting up the workflow

1. In Penpot, create a personal access token (Your account → Access tokens) for
   an account that can read the design file.
2. Add it as the repository secret `PENPOT_ACCESS_TOKEN`.
3. Optional: `DESIGN_PULL_PR_TOKEN`, a fine-grained GitHub token with contents
   and pull-requests write on this repository. A pull request opened with the
   workflow's own `GITHUB_TOKEN` does not trigger other workflows, so without
   this its CI has to be started by hand.

The workflow's `GITHUB_TOKEN` permissions are `contents: write`, to push the
`design/penpot-tokens` branch, and `pull-requests: write`, to open the pull
request. It has nothing else.
