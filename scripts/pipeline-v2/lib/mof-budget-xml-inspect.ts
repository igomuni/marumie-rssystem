/**
 * 財務省 予算書【XML版】の research / inspection 用ユーティリティ（production parser ではない）。
 * - 最小の XML tokenizer（この帳票 XML が使う範囲: 宣言・PI・DOCTYPE・コメント・CDATA・要素・属性・文字データ）
 * - 構造 inventory のための純関数（element path・属性・fingerprint）
 * 意味（どの tag が項・事項か）は決め打ちしない。network・fs に触れない。
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  /** 子（要素 or 文字データ。CDATA は `cdata: true`） */
  children: (XmlNode | XmlText)[];
}
export interface XmlText { text: string; cdata: boolean }

export interface ParsedXml {
  declaration: { version: string | null; encoding: string | null } | null;
  /** `<?xml-stylesheet ...?>` など宣言以外の処理命令 */
  processingInstructions: string[];
  doctype: string | null;
  root: XmlNode;
}

export function isNode(c: XmlNode | XmlText): c is XmlNode { return (c as XmlNode).name !== undefined; }

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
  return out;
}

/** well-formed な XML 文字列（デコード済み）を木にする。不正なら throw */
export function parseXml(src: string): ParsedXml {
  let i = 0;
  const n = src.length;
  let declaration: ParsedXml['declaration'] = null;
  const pis: string[] = [];
  let doctype: string | null = null;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  while (i < n) {
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i);
      if (end < 0) throw new Error('unterminated PI');
      const body = src.slice(i + 2, end).trim();
      if (/^xml(\s|$)/.test(body)) { const a = parseAttrs(body); declaration = { version: a.version ?? null, encoding: a.encoding ?? null }; } else pis.push(body);
      i = end + 2;
    } else if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i);
      if (end < 0) throw new Error('unterminated comment');
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i);
      if (end < 0) throw new Error('unterminated CDATA');
      const top = stack[stack.length - 1];
      if (!top) throw new Error('CDATA outside root');
      top.children.push({ text: src.slice(i + 9, end), cdata: true });
      i = end + 3;
    } else if (src.startsWith('<!DOCTYPE', i)) {
      const end = src.indexOf('>', i);
      if (end < 0) throw new Error('unterminated DOCTYPE');
      doctype = src.slice(i + 2, end).trim();
      i = end + 1;
    } else if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i);
      const name = src.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`mismatched end tag </${name}>`);
      i = end + 1;
    } else if (src[i] === '<') {
      const end = src.indexOf('>', i);
      if (end < 0) throw new Error('unterminated tag');
      let body = src.slice(i + 1, end);
      const selfClose = body.endsWith('/');
      if (selfClose) body = body.slice(0, -1);
      const sp = body.search(/\s/);
      const name = sp < 0 ? body : body.slice(0, sp);
      const node: XmlNode = { name, attrs: sp < 0 ? {} : parseAttrs(body.slice(sp)), children: [] };
      const top = stack[stack.length - 1];
      if (top) top.children.push(node); else if (root) throw new Error('multiple roots'); else root = node;
      if (!selfClose) stack.push(node);
      i = end + 1;
    } else {
      const next = src.indexOf('<', i);
      const end = next < 0 ? n : next;
      const text = src.slice(i, end);
      const top = stack[stack.length - 1];
      if (top && text.trim() !== '') top.children.push({ text: decodeEntities(text), cdata: false });
      i = end;
    }
  }
  if (stack.length > 0 || !root) throw new Error('unclosed element or no root');
  return { declaration, processingInstructions: pis, doctype, root };
}

/** 要素の直下の文字データ（CDATA・通常）だけを連結する（子要素の text は含めない） */
export function ownText(node: XmlNode): string {
  return node.children.filter((c): c is XmlText => !isNode(c)).map(c => c.text).join('');
}

/** 部分木のすべての文字データを文書順に連結する */
export function deepText(node: XmlNode): string {
  return node.children.map(c => (isNode(c) ? deepText(c) : c.text)).join('');
}

/** 要素 path（root からの tag 名の列）ごとの node 数・属性名集合・直下に文字データを持つ node 数を数える */
export interface PathStat { nodes: number; attrNames: Record<string, number>; withOwnText: number }
export function collectPathStats(root: XmlNode): Map<string, PathStat> {
  const out = new Map<string, PathStat>();
  const walk = (node: XmlNode, path: string) => {
    const p = `${path}/${node.name}`;
    const st = out.get(p) ?? { nodes: 0, attrNames: {}, withOwnText: 0 };
    st.nodes++;
    for (const a of Object.keys(node.attrs)) st.attrNames[a] = (st.attrNames[a] ?? 0) + 1;
    if (ownText(node).trim() !== '') st.withOwnText++;
    out.set(p, st);
    for (const c of node.children) if (isNode(c)) walk(c, p);
  };
  walk(root, '');
  return out;
}

/** 構造 fingerprint の素材: 出現する element path の集合と、path ごとの属性名集合（出現数には依存しない） */
export function structureSignature(stats: Map<string, PathStat>): string {
  return [...stats.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, s]) => `${p}[${Object.keys(s.attrNames).sort().join(',')}]`).join('\n');
}
