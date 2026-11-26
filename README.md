# ui-nightly

A nightly UI quality check for GitHub Actions. It screenshots every Storybook story (and any pages you list) at every breakpoint, theme and reading condition you configure, in Chromium, Firefox and WebKit, compares each shot with its baseline, and checks your CSS against your `browserslist`. You get a table per component and breakpoint, an HTML report with the pictures, and an issue when a night goes red.

It is a reusable workflow plus a small Node CLI. There is no service, no account and no hosted storage: baselines live on a branch of your own repository.

## Quickstart

1. Add `.github/workflows/ui-nightly.yml`:

   ```yaml
   name: ui-nightly
   on:
     schedule: [{ cron: '30 2 * * *' }]
     workflow_dispatch:
       inputs:
         update-baselines: { type: boolean, default: false, description: Accept every changed screenshot }
   jobs:
     ui:
       uses: ofri-peretz/ui-nightly/.github/workflows/nightly.yml@v1
       permissions: { contents: write, issues: write }
       with:
         update-baselines: ${{ inputs.update-baselines || false }}
   ```

2. Run it once from the Actions tab. With no baselines yet, every screenshot is `new`: the run passes and writes them to a branch called `ui-baselines`.
3. From then on it runs every night. A difference fails the run, fills the job summary, and opens one issue. When the change is intended, run the workflow by hand with `update-baselines` ticked, after reading the report.

The workflow builds your Storybook with `npx storybook build` and reads `storybook-static/`. Everything else is a knob: see [Inputs](#workflow-inputs) and [Configuration](#configuration).

`contents: write` is how the baseline branch is written. `issues: write` is the nightly issue. A caller's `permissions` must include both, because a called workflow cannot ask for more than its caller grants.

## What it checks

| Check | How |
| :-- | :-- |
| Every story at every breakpoint | One screenshot per story, viewport and variant, per browser |
| Real devices | A viewport can name a Playwright device (`iPhone 13`, `iPad (gen 7)`, `Pixel 7`, ...): size, user agent, touch, mobile flags |
| Themes and reading conditions | Light, dark, forced colours (high contrast), 200% zoom, 150% text, reduced motion; add any other with `variants` |
| Three engines | `browsers: ["chromium", "firefox", "webkit"]`, one matrix leg each |
| Your browser targets | `browserslist` resolves your targets; the built CSS is scanned for features they cannot run (container queries, `:has()`, `@layer`, nesting, `dvh`, `gap` in flex, ...). A feature inside `@supports` counts as guarded |
| Determinism | Fixed clock, seeded `Math.random`, animations off, fonts and images awaited, fixed timezone and locale, and a stability loop (two identical frames in a row) |
| Flakes | A mismatch is retried from a fresh page. A shot that passes on a retry is reported as **flaky**, never hidden |

Default profiles are `phone` (iPhone 13), `tablet` (iPad gen 7) and `desktop` (1280x800), crossed with `light`, `dark`, `contrast`, `zoom200` (desktop only) and `text150` (phone and desktop): 12 screenshots per story per browser.

## What you get

- **Job summary**: totals, then a table per browser with a row per component and a column per viewport (`ok`, `N diff`, `N new`, `N flaky`), then the regressions, flakes and compatibility findings.
- **`ui-nightly-report` artifact**: `report.html` (expected, actual and difference images for every failure, each with a text label), `results.json` (every shot, for scripts and agents) and `summary.md`.
- **An issue** on scheduled and manual runs: opened on the first red night, commented on each repeat, closed on the first green night.

## How baselines work

Baselines are PNG files on an orphan branch of your repository (`ui-baselines` by default), laid out as `<browser>/<viewport>/<variant>/<story-id>.png`.

- **Why a branch.** Artifacts expire (90 days by default), cannot be diffed or reviewed, and a quiet repository would lose its baseline. Files on your main branch would bloat every clone and review. A branch is versioned, free and never expires, and the workflow clones it at depth 1, so the cost is the current set and not its history.
- **First run**: no branch yet, so every shot is `new`; the branch is created and filled.
- **New stories** are added to the branch by scheduled and manual runs (`baseline-write: auto`). Pull-request runs never write.
- **Changed pixels** are never accepted automatically. Run the workflow with `update-baselines: true` after reading the report. A full run with that flag also prunes baselines of stories that no longer exist.
- **Generate baselines in CI only.** Fonts and text rendering differ between operating systems and runner images. The workflow pins `ubuntu-24.04` (`runs-on`) so the image that wrote a baseline is the image that checks it.

## Faster runs

| Lever | How |
| :-- | :-- |
| Pull requests | `mode: changed` checks only the stories a change can touch: the story file, or a file beside it. Any stylesheet, token, `.storybook/` or lockfile change selects every story. There is no module graph, so this is a heuristic, and the summary says so. Run the full set nightly |
| Sharding | `shards: "auto"` sizes capture jobs from `shotsPerShard`; set a number to choose. Each browser gets its own legs |
| Build once | One job builds; every capture and compat job downloads the result |
| Caches | Playwright browsers are cached per version; baselines are a depth-1 clone |
| Parallel pages | `capture.concurrency` pages per job |
| Nothing to do | If no story is selected, the matrix is skipped |

## Pages as well as stories

```json
{
  "storybook": { "dir": "does-not-exist" },
  "pages": {
    "urls": ["/", "/pricing"],
    "server": { "command": "npm run preview", "url": "http://127.0.0.1:3000" }
  },
  "compat": { "paths": ["build/static/css"] }
}
```

Call the workflow with `build-command` (your site build), `artifact-paths` (the build output, one path per line) and `capture-install: true` so the capture jobs can start the server. Each page is captured in every profile, exactly like a story.

## Configuration

Put `.ui-nightly.json` in the project (or point `config` at another path). Every key is optional. Unknown or misspelled keys fail the run with a suggestion. `viewports` and `variants` merge with the defaults by name, and `null` removes a default. For editor completion add `"$schema": "https://raw.githubusercontent.com/ofri-peretz/ui-nightly/v1/schema.json"`. The table below is generated from the code (`node scripts/gen-docs.mjs`) and a test fails if it goes stale.

<!-- config-reference:start -->

| Key | Default | What it does |
| :-- | :-- | :-- |
| `storybook` |  | Where the built Storybook is and which stories to check. |
| `storybook.dir` | `"storybook-static"` | Directory of a built static Storybook (the output of `storybook build`). It must contain `index.json` or `stories.json`. |
| `storybook.include` | `[]` | Patterns (`*` wildcard, case-insensitive) matched against story id, title and `title/name`. Empty means every story. |
| `storybook.exclude` | `[]` | Same patterns; a match removes the story. |
| `storybook.skipTags` | `["no-visual"]` | Stories carrying any of these tags are skipped. Tag a story `no-visual` to opt it out. |
| `pages` |  | Page URLs to screenshot besides, or instead of, stories. |
| `pages.urls` | `[]` | Paths (`/pricing`) or full URLs. Each is captured in every profile. |
| `pages.baseUrl` | `""` | Base for relative `urls` when no server command is set. |
| `pages.server` |  | A server the workflow starts for the pages. |
| `pages.server.command` | `""` | Shell command that serves the site, run in the working directory. Empty means none. The capture job needs the project installed: set `capture-install: true`. |
| `pages.server.url` | `"http://127.0.0.1:3000"` | URL polled until the server answers. Also the base URL for relative `urls` when a command is set. |
| `pages.server.timeoutSeconds` | `120` | How long to wait for the server before failing. |
| `browsers` | `["chromium"]` | Engines to run: `chromium`, `firefox`, `webkit`. One matrix leg each. |
| `viewports` |  | Named viewports. Merged with the defaults by name; `null` removes a default. Each is `{ "device": "iPhone 13" }` (a Playwright device: size, user agent, touch) or `{ "width", "height" }`. |
| `variants` |  | Named reading conditions, merged with the defaults by name; `null` removes one. A profile is every viewport x variant (a variant may limit itself with `viewports`). |
| `capture` |  | How a page is rendered and photographed. |
| `capture.fullPage` | `true` | Capture the full scroll height rather than only the viewport. |
| `capture.maxHeight` | `4000` | Cap on the captured height in CSS pixels, so an endless page cannot make an endless image. |
| `capture.deviceScaleFactor` | `1` | Pixel density. 1 keeps images small; a viewport can override it with its own `deviceScaleFactor`. |
| `capture.timezone` | `"UTC"` | Timezone id, fixed for determinism. |
| `capture.locale` | `"en-US"` | Locale, fixed for determinism. |
| `capture.fixedTime` | `"2026-01-01T12:00:00Z"` | ISO time the page clock is fixed to. Empty leaves the real clock. |
| `capture.seedRandom` | `true` | Replace `Math.random` with a seeded generator. |
| `capture.disableAnimations` | `true` | Disable CSS animations and transitions and hide the caret. |
| `capture.reducedMotion` | `"reduce"` | `prefers-reduced-motion` for every profile (`reduce` or `no-preference`). A variant can override it. |
| `capture.settleMs` | `100` | Pause after the page is ready, before the first frame. |
| `capture.timeoutMs` | `30000` | Per-step timeout: navigation, story render, selector wait. |
| `capture.stabilityTries` | `3` | Take frames until two in a row are identical, up to this many. 1 turns the check off. |
| `capture.retries` | `2` | Extra attempts for a mismatching or failing shot. A shot that passes on a retry is reported as flaky, not hidden. |
| `capture.concurrency` | `2` | Pages rendered in parallel within one capture job. |
| `capture.waitForSelector` | `""` | CSS selector that must exist before the frame is taken (for example a skeleton gone). |
| `capture.hideSelectors` | `[]` | Selectors hidden with `visibility: hidden` (ads, timestamps, carousels). |
| `capture.css` | `""` | CSS injected into every page before the frame. |
| `compare` |  | How a screenshot is compared with its baseline. |
| `compare.threshold` | `0.1` | Per-pixel perceptual tolerance, 0 (exact) to 1. |
| `compare.maxDiffPixels` | `0` | A shot fails when differing pixels exceed `max(maxDiffPixels, maxDiffPixelRatio x pixels)`. |
| `compare.maxDiffPixelRatio` | `0.0005` | Fraction of pixels allowed to differ. A change of image size always fails. |
| `compare.overrides` | `[]` | Per-story tolerances: `[{ "match": "button*", "maxDiffPixelRatio": 0.01 }]`. Later entries win. |
| `shards` | `"auto"` | Capture jobs per browser: a number, or `auto` to size from `shotsPerShard`. |
| `shotsPerShard` | `400` | Target screenshots per capture job when `shards` is `auto`. |
| `changed` |  | How `mode: changed` (pull requests) picks stories. |
| `changed.globalPatterns` | `["*.css","*.scss","*.sass","*.less","*.pcss","*tokens*","*.storybook/*","package.json","package-lock.json","pnpm-lock.yaml","yarn.lock"]` | Any changed file matching one of these selects every story (stylesheets, tokens, Storybook config, lockfiles). |
| `changed.siblingDirectory` | `true` | A changed file in the same directory as a story file selects that story. No module graph is built; this is a heuristic. |
| `compat` |  | The browserslist CSS compatibility check. |
| `compat.enabled` | `true` | Run the check. |
| `compat.paths` | `[]` | Directories or files to scan for CSS (`.css`, and `<style>` in `.html`). Empty means the staged Storybook. |
| `compat.browserslist` | `[]` | Queries that replace the project's own browserslist config. Empty means use `.browserslistrc` / `package.json`. |
| `compat.fail` | `"unsupported"` | `unsupported` fails when a target lacks a feature, `partial` also on partial support, `never` only reports. |
| `compat.ignoreFeatures` | `[]` | caniuse feature ids to skip, for example `css-has`. |
| `compat.ignoreFiles` | `["*/sb-manager/*","*/sb-addons/*","*/sb-common-assets/*"]` | Patterns (`*` wildcard) of files to skip. Storybook's own UI assets are skipped by default. |

**Each entry of `viewports`**

| Key | What it does |
| :-- | :-- |
| `device` | A Playwright device name such as `iPhone 13` or `iPad (gen 7)`. Brings the size, user agent, touch and mobile flags. |
| `width` | CSS pixel width (with `height`, instead of `device`; overrides the device). |
| `height` | CSS pixel height. |
| `deviceScaleFactor` | Pixel density for this viewport. Default: `capture.deviceScaleFactor`. |
| `isMobile` | Mobile viewport behaviour. Ignored on Firefox, which does not support it. |
| `hasTouch` | Touch events. |
| `browsers` | Engines this viewport is captured in. Omit for all. Use it to keep Firefox and WebKit to a smaller set. |

**Each entry of `variants`**

| Key | What it does |
| :-- | :-- |
| `colorScheme` | `light` or `dark`: the `prefers-color-scheme` media feature. |
| `forcedColors` | `active` emulates forced-colors (Windows high contrast); `none` is off. |
| `contrast` | `more` or `no-preference`: the `prefers-contrast` media feature. |
| `reducedMotion` | `reduce` or `no-preference` for this variant. Default: `capture.reducedMotion`. |
| `zoom` | Browser zoom factor. 2 is 200%: half the CSS viewport at twice the pixel density. |
| `textScale` | Root `font-size` as a multiple (1.5 is 150% text). Finds fixed-pixel text. |
| `globals` | Storybook globals sent as `&globals=key:value;...`, for example `{ "theme": "dark" }`. |
| `htmlAttributes` | Attributes set on `<html>`, for example `{ "data-theme": "dark" }`. |
| `htmlClass` | Classes added to `<html>`, for example `["dark"]`. |
| `css` | CSS injected for this variant only. |
| `viewports` | Names of the viewports this variant applies to. Omit for all. |
| `browsers` | Engines this variant is captured in. Omit for all. |

**Each entry of `compare.overrides`**

| Key | What it does |
| :-- | :-- |
| `match` | Pattern matched against story id, title and `title/name`. |
| `threshold` | Per-pixel tolerance for matching stories. |
| `maxDiffPixels` | Allowed differing pixels for matching stories. |
| `maxDiffPixelRatio` | Allowed fraction of differing pixels for matching stories. |

<!-- config-reference:end -->

### Workflow inputs

| Input | Default | What it does |
| :-- | :-- | :-- |
| `config` | `.ui-nightly.json` | Config path, relative to `working-directory`. A missing file means all defaults |
| `working-directory` | `.` | Project directory (install and build run here) |
| `node-version` | `22` | Node for your build and for ui-nightly (22.3 or newer) |
| `install-command` | `npm ci --no-audit --no-fund` | Installs your dependencies. Empty to skip |
| `build-command` | `npx storybook build` | Builds the Storybook or site. Empty to skip |
| `artifact-paths` | empty | Extra build outputs shipped to the capture and compat jobs, one per line |
| `capture-install` | `false` | Also install in the capture jobs (needed for `pages.server.command`) |
| `mode` | `full` | `full` or `changed` |
| `base-ref` | pull request base, else the default branch | Base for `changed` |
| `runs-on` | `ubuntu-24.04` | Runner. Baselines are only valid on the image that made them |
| `max-parallel` | `6` | Parallel capture jobs |
| `baseline-branch` | `ui-baselines` | Branch that stores baselines |
| `baseline-write` | `auto` | `auto` (not on pull requests), `always`, `never` |
| `update-baselines` | `false` | Accept every changed screenshot |
| `fail-on-regression` | `true` | Fail the workflow on a regression or compat failure |
| `open-issue` | `true` | Nightly issue on scheduled and manual runs |
| `issue-label` | `ui-nightly` | Label for that issue |
| `tool-repo`, `tool-ref` | `ofri-peretz/ui-nightly`, `v1` | Where ui-nightly itself comes from. If you pin `@<sha>` in `uses:`, set `tool-ref` to the same sha |

Outputs: `regressions` (count) and `failed` (`true` or `false`).

## Run it locally

The same commands run in CI and on a laptop (Node 22.3 or newer):

```bash
git clone https://github.com/ofri-peretz/ui-nightly && cd ui-nightly && npm ci
npx playwright-core install chromium
cd your-project
node /path/to/ui-nightly/src/cli.mjs plan --storybook-dir storybook-static
node /path/to/ui-nightly/src/cli.mjs capture --browser chromium --shard 0 --shards 1
node /path/to/ui-nightly/src/cli.mjs report --results ui-nightly-out --plan ui-nightly-out/plan.json --write-baselines ui-nightly-out/baselines
node /path/to/ui-nightly/src/cli.mjs compat
```

`check-config` validates a config file. Local screenshots are only comparable with other local screenshots: do not mix them with CI baselines.

## How it is checked

Every claim above is exercised by this repository's own CI (`.github/workflows/ci.yml`):

- Unit tests for the PNG codec, the diff, config validation, sharding, changed-mode selection and the CSS scanner.
- An end-to-end run per browser on a fixture: bootstrap, an unchanged rerun that must pass, a deliberate CSS change that must fail with a diff image, an old `browserslist` that must fail compat, and a misspelled key that must fail loudly.
- The reusable workflow itself, three times against a real tiny Storybook: bootstrap the baselines, compare (must be green), and detect a deliberate regression (must be red).

## Measured

These numbers come from runs, with the command that made them. They are not promises.

| What | Result | How, when |
| :-- | :-- | :-- |
| Capture speed, one job | 60 screenshots (5 stories x 12 profiles) in 13.6 s, 4.4 shots/s | Chromium headless shell, `capture.concurrency` 2, Apple silicon laptop, 2026-11-26: `node src/cli.mjs capture` on `fixtures/static-storybook` |
| Repeatability | 0 of 60 screenshots differ between two consecutive runs, including a story that renders the date, a random number and a spinner | Same command, run twice, same day |
| Compat scan | 1.1 s for the fixture's CSS against the project's `browserslist` defaults | `time node src/cli.mjs compat --paths fixtures/static-storybook` |
| Hosted runner | CI_NUMBERS | The `selftest-*` jobs in `.github/workflows/ci.yml` |

Numbers for your project depend on its story count, page weight and runner. The job summary prints runner seconds, and `results.json` records the time of every shot.

## Limits

- Screenshots compare pixels. There is no anti-aliasing heuristic; the per-pixel `threshold` absorbs it on a single pinned runner image.
- The compat check knows the CSS features listed in `src/features.mjs` that caniuse-lite has an id for. Features caniuse does not track (for example `aspect-ratio`, `color-mix()`) are not checked. It reads CSS and `<style>` blocks, not CSS-in-JS at runtime.
- `mode: changed` is a heuristic with no module graph.
- JSON only for config: YAML needs a parser, and this project has none. The runtime dependencies are `playwright-core`, `browserslist` and `caniuse-lite`.
- 200% zoom is emulated as half the CSS viewport at twice the pixel density, which is what browser zoom does to layout. 150% text sets the root `font-size`, so it only affects `rem`-based sizing, which is what it is for.

## License

MIT
