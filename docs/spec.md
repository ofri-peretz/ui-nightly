# Spec: ui-nightly

Implements `docs/intent.md`. Accepted by the owner's waiver (see intent).

## Shape

A **reusable workflow** (`.github/workflows/nightly.yml`, `on: workflow_call`) plus a small
Node CLI (`src/cli.mjs`) that the workflow checks out next to the caller's code. A caller writes:

```yaml
jobs:
  ui:
    uses: ofri-peretz/ui-nightly/.github/workflows/nightly.yml@v1
    permissions: { contents: write, issues: write }
```

The CLI has five commands: `plan`, `capture`, `report`, `compat`, `check-config`. They run
locally the same way they run in Actions, so a failure can be reproduced without CI.

### Why a reusable workflow and not a composite action

The product is an orchestration (build once, shard across a browser matrix, merge, report,
write baselines, file an issue). A composite action runs inside one job and cannot fan out; a
reusable workflow can. Callers who want only one piece can call the CLI directly.

### Why the workflow checks out its own tool

A reusable workflow cannot read files from its own repository by relative path. The workflow
takes `tool-ref` (default `v1`) and checks `ofri-peretz/ui-nightly` out at that ref. A caller
that pins `@v1` gets `v1` for both. A caller that pins a SHA sets `tool-ref` to the same SHA.

## Pipeline

```text
build ──► capture (matrix: browser x shard) ──┐
  │                                           ├─► report ─► baselines branch, issue, summary, HTML
  └─► compat (browserslist CSS check) ────────┘
```

1. **build**: install, run the caller's build command, read the Storybook `index.json` (or
   `stories.json`), apply include/exclude/tag filters, in `changed` mode keep only affected
   stories, compute the matrix, upload the build output and `plan.json`.
2. **capture**: for one browser and one shard, serve the static build on a loopback port, render
   each story in each profile, compare with the baseline, retry mismatches, write results and
   the images that matter.
3. **compat**: resolve `browserslist`, scan the built CSS, report features the targets do not
   support.
4. **report**: merge results, write the job summary and HTML report, write baselines, open or
   update the issue, set the final status.

## Profiles: breakpoints, devices, themes, reading conditions

A **viewport** is a name plus either a Playwright device (`{"device": "iPhone 13"}`, which brings
the user agent, touch and mobile flags) or `{width, height}`. A **variant** is a named reading
condition: colour scheme, forced colours, contrast, reduced motion, zoom, text scale, Storybook
globals, HTML attributes and classes, extra CSS. A **profile** is viewport x variant; a variant
may list the viewports it applies to.

Defaults: viewports `phone` (iPhone 13), `tablet` (iPad gen 7), `desktop` (1280x800); variants
`light`, `dark`, `contrast` (forced colours), `zoom200` (desktop only), `text150` (phone and
desktop). That is 12 profiles per story per browser.

- **200% zoom** is emulated as half the CSS viewport at twice the device scale factor, which is
  what browser zoom does to layout. Pixel output keeps the base size.
- **150% text** sets the root `font-size` to 150%. It only affects rem-based sizing, which is
  the point: it finds fixed-pixel text.
- **Themes** apply three ways at once, because design systems differ: the
  `prefers-color-scheme` media feature, Storybook `globals=`, and configured HTML
  attributes/classes.
- **Reduced motion** is on by default, and animations are disabled, for determinism.

## Determinism

Fixed clock (`page.clock.setFixedTime`), seeded `Math.random`, animations and caret disabled,
fonts awaited, images awaited, timezone and locale pinned, a configurable settle delay, and a
stability loop: shoot until two consecutive frames are byte-identical (max `stabilityTries`).
Baselines must be produced by the same runner image that checks them; the workflow pins
`ubuntu-24.04` (Playwright does not support Chromium on 26.04 yet) and refuses to mix.

## Comparison

Own PNG decoder and encoder over `node:zlib`, and a YIQ perceptual per-pixel delta (the method
pixelmatch popularised) with a per-pixel `threshold`. A shot fails when differing pixels exceed
`max(maxDiffPixels, maxDiffPixelRatio x pixels)`. A size change always fails. Overrides by
story glob. Reason for writing it: ecosystem principle 2 (zero external dependencies) and it is
about 150 lines; the cost is no anti-aliasing heuristic, which the threshold absorbs on a
single pinned runner. Measured before claiming (README).

### Flakes are reported, never hidden

A mismatch is retried up to `retries` times from a fresh page. A shot that fails then passes is
**flaky**: it passes the gate but is counted and listed with its attempts. A shot that never
settles is **unstable**: listed as a warning.

## Baselines

Stored on an **orphan branch of the caller's repository** (`ui-baselines`). Chosen over
artifacts because artifacts expire (default 90 days, and a quiet repo's baseline would vanish),
cannot be diffed or reviewed, and cannot be pinned to a commit. Chosen over files on the main
branch because tens of thousands of PNGs would bloat every clone and every code review. The
branch is cloned with depth 1, so the cost is the current set, not the history.

- First run with no branch: every shot is `new`, passes, and (bootstrap) is written.
- `environment.json` at the branch root records, per baseline, a digest of the font files the page loaded when the baseline was made. The report compares failing shots with it and names changed font files (a font fetched at build time can differ between builds of one commit).
- Scheduled/dispatch runs with `baseline-write: auto` add new shots; `update-baselines: true`
  (a dispatch input) also accepts every changed shot. A person triggers that after reading the
  report. The run is green: an accepted shot is the new baseline, so it is listed as accepted and
  not counted as a regression, and the issue is closed as resolved. Errors, missing results and
  compat failures are not accepted, and a run that writes nothing accepts nothing. Pull-request runs never write.
- Layout: `<browser>/<viewport>/<variant>/<story-id>.png`.

Considered and not done: Git LFS (a second service to configure, and a billing surface),
committing next to the code (see above), a storage service (principle 1).

## Compatibility check

`browserslist` resolves the caller's targets (their `.browserslistrc`/`package.json`, or
`compat.browserslist`). A small CSS scanner (comments and strings removed, brace-aware, tracks
`@supports`) finds uses of ~40 features and maps each to a caniuse-lite feature id. Each target
is looked up in that feature's support table. Output is per file, feature and unsupported
target. A feature used only inside a matching `@supports` block is guarded and ignored.
`compat.fail` chooses the gate: `unsupported` (default), `partial`, or `never`.

Not done: vendor-prefix advice (autoprefixer's job), JavaScript API checks, a full CSS parser.
The runtime dependencies are `browserslist` and `caniuse-lite`, which are the data source
itself; there is no copy of that data to keep honest. Visual coverage across `chromium`,
`firefox` and `webkit` is the other half of compatibility, and is a `browsers` setting.

## Optimisations

| Lever | Mechanism |
| :-- | :-- |
| Matrix | browser x shard; `shards` is a number or `auto` (target `shotsPerShard`) |
| Changed-only | `mode: changed` keeps stories whose file, or a sibling file, changed; any global pattern (CSS, tokens, `.storybook`, lockfile) selects all |
| Build once | one build, shared as an artifact |
| Cache | Playwright browsers keyed by version; baselines are a depth-1 clone |
| Concurrency | `capture.concurrency` pages per browser |
| Early exit | zero selected stories skips the matrix |

The changed-only mapping is a heuristic (no module graph) and says so in its output.

## Outputs

- Job summary: totals, then one table per browser with a row per component and a column per
  profile (`ok`, `diff n`, `new`, `flaky`, `error`), then a compat table.
- `report.html`: self-contained, expected / actual / diff images for every failure, with text
  alternatives. Artifact `ui-nightly-report`.
- `results.json`: the same data for agents and scripts.
- Issue (`open-issue`, default on for schedule): one issue titled by the workflow, opened on
  failure, commented on repeat, closed when a night is green.

## Config

One file, `.ui-nightly.json` (JSON because YAML needs a parser and principle 2 says no). Every
key has a default; unknown keys fail `check-config`; `schema.json` gives editors completion.
Maps (`viewports`, `variants`) merge with the defaults, and `null` removes a default entry.
The README is the full reference and a test fails if a key is missing from it.

## Self-test (rule 4: a check must fail on the unfixed state)

1. Unit tests: PNG round-trip, diff, config validation, sharding, changed mapping, CSS scanner.
2. End-to-end on a fixture, per browser: bootstrap creates baselines; an immediate re-run
   passes; a deliberate CSS change fails with a diff image and exit 1; a deliberate
   out-of-target CSS feature fails compat.
3. The reusable workflow itself, called from this repo against a real tiny Storybook build,
   twice (bootstrap then compare) on a throwaway baseline branch.

## Rejected roads

- Playwright Test's `toHaveScreenshot`: ties the product to its runner and snapshot naming.
- Hosted visual-diff services: principle 1.
- YAML config: needs a parser.
- Storing baselines as artifacts: expiry.
- One repository per action: principle 10, one repo per family.
