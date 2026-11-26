// A small brace-aware CSS scanner. Not a full parser: enough structure to know which
// at-rules, selectors and declarations a file uses and whether they sit inside @supports.

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * @returns {Array<{type:'at'|'rule', name?:string, prelude:string, decls:{prop:string,value:string}[],
 *   line:number, guarded:boolean, nested:boolean}>}
 */
export function scanCss(source) {
  const css = stripComments(source);
  const nodes = [];
  const stack = [];
  let buf = '';
  let paren = 0;
  let quote = '';
  let line = 1;
  let bufLine = 1;
  const top = () => stack[stack.length - 1];

  const addDecl = (text) => {
    const t = text.trim();
    if (!t || !top()) return;
    const i = t.indexOf(':');
    if (i < 1) return;
    top().node.decls.push({ prop: t.slice(0, i).trim().toLowerCase(), value: t.slice(i + 1).trim() });
  };

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\n') line++;
    if (quote) {
      buf += ch;
      if (ch === '\\') { buf += css[++i] ?? ''; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; if (!buf.trim()) bufLine = line; buf += ch; continue; }
    if (ch === '(') paren++;
    if (ch === ')') paren = Math.max(0, paren - 1);
    if (paren > 0) { if (!buf.trim()) bufLine = line; buf += ch; continue; }
    if (ch === '{') {
      const prelude = buf.trim();
      const parent = top();
      const isAt = prelude.startsWith('@');
      const name = isAt ? prelude.slice(1).match(/^[\w-]+/)?.[0]?.toLowerCase() : undefined;
      const node = {
        type: isAt ? 'at' : 'rule', name, prelude: isAt ? prelude.slice(name.length + 1).trim() : prelude,
        decls: [], line: bufLine,
        guarded: Boolean(parent?.node.guarded || (isAt && name === 'supports')),
        nested: stack.some((f) => f.node.type === 'rule'),
      };
      stack.push({ node });
      nodes.push(node);
      buf = '';
    } else if (ch === ';') {
      const t = buf.trim();
      if (t.startsWith('@')) {
        const name = t.slice(1).match(/^[\w-]+/)?.[0]?.toLowerCase();
        nodes.push({ type: 'at', name, prelude: t.slice(name.length + 1).trim(), decls: [], line: bufLine, guarded: Boolean(top()?.node.guarded), nested: false, statement: true });
      } else addDecl(buf);
      buf = '';
    } else if (ch === '}') {
      addDecl(buf);
      buf = '';
      stack.pop();
    } else {
      if (!buf.trim()) bufLine = line;
      buf += ch;
    }
  }
  return nodes;
}

/** Extract CSS text from an HTML file's <style> blocks. */
export function styleBlocks(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => ({
    css: m[1], offset: html.slice(0, m.index).split('\n').length - 1,
  }));
}
