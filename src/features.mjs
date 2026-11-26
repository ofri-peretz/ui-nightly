// Catalogue of CSS features the compat check recognises, each tied to a caniuse-lite feature id.
// A test asserts every id exists in the installed caniuse-lite, so a data update that renames
// one fails loudly instead of silently checking nothing.

const has = (re, s) => re.test(s);
const anyDecl = (n, prop, valueRe) => n.decls.some((d) => (!prop || prop.test(d.prop)) && (!valueRe || valueRe.test(d.value)));

export const FEATURES = [
  { id: 'css-container-queries', label: '@container queries', test: (n) => n.type === 'at' && n.name === 'container' },
  { id: 'css-container-query-units', label: 'container query units (cqw, cqh, ...)', test: (n) => anyDecl(n, null, /\d(cqw|cqh|cqi|cqb|cqmin|cqmax)\b/) },
  { id: 'css-has', label: ':has()', test: (n) => n.type === 'rule' && has(/:has\(/, n.prelude) },
  { id: 'css-cascade-layers', label: '@layer', test: (n) => n.type === 'at' && n.name === 'layer' },
  { id: 'css-cascade-scope', label: '@scope', test: (n) => n.type === 'at' && n.name === 'scope' },
  { id: 'css-nesting', label: 'CSS nesting', test: (n) => n.type === 'rule' && n.nested && has(/&/, n.prelude) },
  { id: 'css-subgrid', label: 'subgrid', test: (n) => anyDecl(n, /^grid-template-(rows|columns)$/, /\bsubgrid\b/) },
  { id: 'css-grid', label: 'CSS grid', test: (n) => anyDecl(n, /^display$/, /\b(inline-)?grid\b/) },
  {
    id: 'flexbox-gap', label: 'gap in flex layouts',
    test: (n) => anyDecl(n, /^display$/, /\b(inline-)?flex\b/) && anyDecl(n, /^(gap|row-gap|column-gap)$/),
  },
  { id: 'css-math-functions', label: 'clamp() / min() / max()', test: (n) => anyDecl(n, null, /(^|[^\w-])(clamp|min|max)\(/) },
  { id: 'css-variables', label: 'custom properties (var())', test: (n) => anyDecl(n, null, /\bvar\(/) },
  { id: 'css-lch-lab', label: 'lab() / lch() / oklab() / oklch()', test: (n) => anyDecl(n, null, /\b(ok)?(lab|lch)\(/) },
  { id: 'css-color-function', label: 'color()', test: (n) => anyDecl(n, null, /(^|[^\w-])color\(/) },
  { id: 'css-relative-colors', label: 'relative colour syntax', test: (n) => anyDecl(n, null, /\b(rgb|hsl|hwb|lab|lch|oklab|oklch)\(\s*from\b/) },
  { id: 'viewport-unit-variants', label: 'dvh / svh / lvh units', test: (n) => anyDecl(n, null, /\d(dv|sv|lv)(h|w|i|b|min|max)\b/) },
  { id: 'css-logical-props', label: 'logical properties (inline/block)', test: (n) => anyDecl(n, /^(margin|padding|border|inset)-(inline|block)(-start|-end)?(-(width|style|color))?$|^(inline|block)-size$|^inset$/) },
  { id: 'css-focus-visible', label: ':focus-visible', test: (n) => n.type === 'rule' && has(/:focus-visible/, n.prelude) },
  { id: 'css-focus-within', label: ':focus-within', test: (n) => n.type === 'rule' && has(/:focus-within/, n.prelude) },
  { id: 'css-matches-pseudo', label: ':is() / :where()', test: (n) => n.type === 'rule' && has(/:(is|where)\(/, n.prelude) },
  { id: 'css-not-sel-list', label: ':not() with a selector list', test: (n) => n.type === 'rule' && has(/:not\([^)]*,/, n.prelude) },
  { id: 'css-nth-child-of', label: ':nth-child(... of S)', test: (n) => n.type === 'rule' && has(/:nth-(last-)?child\([^)]*\sof\s/, n.prelude) },
  { id: 'css-sticky', label: 'position: sticky', test: (n) => anyDecl(n, /^position$/, /\bsticky\b/) },
  { id: 'css-backdrop-filter', label: 'backdrop-filter', test: (n) => anyDecl(n, /^backdrop-filter$/) },
  { id: 'css-scrollbar', label: 'scrollbar-width / scrollbar-color', test: (n) => anyDecl(n, /^scrollbar-(width|color)$/) },
  { id: 'css-text-wrap-balance', label: 'text-wrap: balance', test: (n) => anyDecl(n, /^text-wrap$/, /\bbalance\b/) },
  { id: 'view-transitions', label: 'view transitions', test: (n) => anyDecl(n, /^view-transition-name$/) || (n.type === 'rule' && has(/::view-transition/, n.prelude)) },
  { id: 'css-anchor-positioning', label: 'anchor positioning', test: (n) => anyDecl(n, /^(anchor-name|position-anchor)$/) },
  { id: 'prefers-color-scheme', label: 'prefers-color-scheme', test: (n) => n.type === 'at' && n.name === 'media' && has(/prefers-color-scheme/, n.prelude) },
  { id: 'prefers-reduced-motion', label: 'prefers-reduced-motion', test: (n) => n.type === 'at' && n.name === 'media' && has(/prefers-reduced-motion/, n.prelude) },
  { id: 'css-media-range-syntax', label: 'media query range syntax (width >= 600px)', test: (n) => n.type === 'at' && n.name === 'media' && has(/[<>]=?\s*\d|\d\w*\s*[<>]=?\s*(width|height)|(width|height)\s*[<>]/, n.prelude) },
  { id: 'css-conic-gradients', label: 'conic-gradient()', test: (n) => anyDecl(n, null, /conic-gradient\(/) },
  { id: 'css-content-visibility', label: 'content-visibility', test: (n) => anyDecl(n, /^content-visibility$/) },
  { id: 'css-masks', label: 'CSS masks', test: (n) => anyDecl(n, /^(-webkit-)?mask(-image|-size|-position|-repeat|-mode)?$/) },
  { id: 'css-clip-path', label: 'clip-path', test: (n) => anyDecl(n, /^clip-path$/) },
  { id: 'css-env-function', label: 'env()', test: (n) => anyDecl(n, null, /\benv\(/) },
  { id: 'css-mixblendmode', label: 'mix-blend-mode', test: (n) => anyDecl(n, /^mix-blend-mode$/) },
  { id: 'css-overscroll-behavior', label: 'overscroll-behavior', test: (n) => anyDecl(n, /^overscroll-behavior(-x|-y)?$/) },
  { id: 'css-scroll-behavior', label: 'scroll-behavior', test: (n) => anyDecl(n, /^scroll-behavior$/) },
  { id: 'css-snappoints', label: 'scroll snap', test: (n) => anyDecl(n, /^scroll-snap-(type|align|stop)$/) },
  { id: 'css-touch-action', label: 'touch-action', test: (n) => anyDecl(n, /^touch-action$/) },
  { id: 'css-writing-mode', label: 'writing-mode', test: (n) => anyDecl(n, /^writing-mode$/) },
  { id: 'css-initial-letter', label: 'initial-letter', test: (n) => anyDecl(n, /^initial-letter$/) },
  { id: 'css-text-box-trim', label: 'text-box-trim', test: (n) => anyDecl(n, /^text-box(-trim|-edge)?$/) },
  { id: 'css-zoom', label: 'zoom', test: (n) => anyDecl(n, /^zoom$/) },
  { id: 'css-appearance', label: 'appearance', test: (n) => anyDecl(n, /^appearance$/) },
  { id: 'css-text-align-last', label: 'text-align-last', test: (n) => anyDecl(n, /^text-align-last$/) },
  { id: 'css-image-set', label: 'image-set()', test: (n) => anyDecl(n, null, /image-set\(/) },
  { id: 'css-font-palette', label: 'font-palette', test: (n) => anyDecl(n, /^font-palette$/) },
  { id: 'css-if', label: 'if()', test: (n) => anyDecl(n, null, /(^|[^\w-])if\(/) },
];

export function detect(node) {
  return FEATURES.filter((f) => { try { return f.test(node); } catch { return false; } });
}
