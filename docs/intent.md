# Intent: a nightly UI quality check anyone can reuse

Status: accepted (the owner waived human acceptance at Design to Build and at Deploy for this
work; recorded here so the next reader can see that it was a decision, not an omission).

## The problem

Teams that ship a design system or a web app check UI quality when a pull request opens, in
one browser, at one width. Defects that live between those points arrive unnoticed:

- a component that is fine on desktop and broken on a phone or tablet,
- a dark, high-contrast, 200% zoom or 150% text reading that nobody looked at,
- a CSS feature the declared `browserslist` targets do not support,
- a Firefox or WebKit rendering that differs from Chromium,
- drift that no single pull request caused and no single review would catch.

A nightly run catches all of these because it is not tied to one change. It has to be cheap to
adopt, or it will not be.

## What we want

A repository adds one small workflow file and one optional config file, and gets a nightly
report that says, per component and per breakpoint, what looks different from yesterday and
which CSS the declared browser targets cannot run.

## Who calls it

| Caller | What they need |
| :-- | :-- |
| A maintainer reading Monday's report | One table, per component and breakpoint, with the picture beside it |
| A contributor on a pull request | Only the stories the change can touch, fast |
| An agent | The same result as JSON, plus a config schema to read |
| CI | A non-zero exit when the check fails, an issue when a nightly regresses |
| A screen reader user | The summary is Markdown tables and plain text; the HTML report has text for every picture |

## Measures of success

1. A repo with a built Storybook is checking every story at three breakpoints in under ten lines
   of workflow. Measured: lines in `examples/nightly.yml`.
2. A deliberate visual change in the fixture is reported, and the same fixture without it passes.
   Measured by the self-test, which must fail on the unfixed state.
3. A CSS feature outside the declared targets is reported, and a guarded one is not.
4. Every knob is documented and validated; a misspelled key fails loudly instead of being ignored.
5. Numbers in the README (run time, shots per second) come from a run, with the command and date.

## Out of scope

- A hosted service, a dashboard, or accounts (ecosystem principle 1: packages, never services).
- Replacing functional or end-to-end tests. This checks how things look and what CSS runs where.
- Auto-approval of visual changes. A person decides which pixels are intended.

## Kill criteria

If, after a month of nightly runs in two repositories, the report is ignored (no issue is acted
on and no baseline update is reviewed), the product is wrong and this intent is closed.

## Decisions handed off

`docs/spec.md` records the design and every road not taken.
