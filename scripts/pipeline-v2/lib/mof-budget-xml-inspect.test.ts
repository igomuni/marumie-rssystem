import { describe, expect, it } from 'vitest';
import { collectPathStats, deepText, ownText, parseXml, structureSignature } from './mof-budget-xml-inspect';

const SRC = `<?xml version="1.0" encoding="Shift_JIS" ?>
<?xml-stylesheet type="text/xsl" href="a.xsl"?>
<!DOCTYPE budget SYSTEM "../dtd/x.dtd">
<budget>
  <title kind="k"><![CDATA[見出し]]></title>
  <p><l><![CDATA[令和]]><qt></qt><![CDATA[6]]><qt/><![CDATA[年度]]></l><l> a &amp; b</l></p>
</budget>`;

describe('mof budget xml tokenizer', () => {
  const x = parseXml(SRC);
  it('宣言・PI・DOCTYPE・root を取り出す', () => {
    expect(x.declaration).toEqual({ version: '1.0', encoding: 'Shift_JIS' });
    expect(x.processingInstructions).toEqual(['xml-stylesheet type="text/xsl" href="a.xsl"']);
    expect(x.doctype).toBe('DOCTYPE budget SYSTEM "../dtd/x.dtd"');
    expect(x.root.name).toBe('budget');
  });
  it('CDATA・空要素・entity・属性を扱う（子要素の text は ownText に含まれない）', () => {
    const p = x.root.children.find(c => 'name' in c && c.name === 'p');
    expect(p && 'name' in p && deepText(p)).toBe('令和6年度 a & b');
    const l = p && 'name' in p ? p.children[0] : null;
    expect(l && 'name' in l && ownText(l)).toBe('令和6年度');
  });
  it('element path 統計と構造 signature（属性名を含み、出現数を含まない）', () => {
    const st = collectPathStats(x.root);
    expect(st.get('/budget/p/l')?.nodes).toBe(2);
    expect(st.get('/budget/title')?.attrNames).toEqual({ kind: 1 });
    expect(structureSignature(st)).toContain('/budget/title[kind]');
  });
  it('不正な XML は throw する', () => {
    expect(() => parseXml('<a><b></a>')).toThrow();
    expect(() => parseXml('<a>')).toThrow();
  });
});
