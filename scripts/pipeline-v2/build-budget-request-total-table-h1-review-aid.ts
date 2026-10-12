/**
 * H1 GT human review aid: one self-contained HTML page for filling review/human-review.csv.
 *
 *   npx tsx scripts/pipeline-v2/build-budget-request-total-table-h1-review-aid.ts [outputDir] [--annotators=a2,b2] [--reference=a,b]
 *
 * Reads only files already under outputDir (annotation-input/, review/, annotation-<x>/). Writes review/human-review.html.
 * The page shows, per unit: the raw text window (monospace, target and cited rows highlighted), the block rows with the
 * 7 amount cells, sum checks for cited TOTAL scopes, the annotators' decisions and rationales, and the relevant contract
 * clauses. Coordinator hints are hidden by default. The human decides; the page exports a filled human-review.csv.
 * No PDF images: the evidence scope is raw text only (preregistration §6).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseCsv } from './lib/budget-request-total-table-h1-gt-sampling';

const args = process.argv.slice(2);
const flag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = args.find(a => !a.startsWith('--')) ?? 'data/work/budget-request-total-table-h1-gt/2024';
const [whoA, whoB] = (flag('annotators') ?? 'a2,b2').split(',');
const reference = (flag('reference') ?? 'a,b').split(',').filter(Boolean);
const AMOUNT_COLUMNS = ['previous_general', 'previous_other', 'previous_total', 'request_general', 'request_other', 'request_total', 'difference'];

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));
const review = parseCsv(read('review/human-review.csv'));
const units = new Map(parseCsv(read('annotation-input/units.csv')).map(u => [u.sample_id, u]));

const decisionLines = (who: string) => {
  const m = new Map<string, string>();
  const rel = `annotation-${who}/work/decisions.md`;
  if (!exists(rel)) return m;
  for (const line of read(rel).split('\n')) {
    const id = line.split(' | ')[0]?.trim();
    if (id && units.has(id)) m.set(id, line.slice(id.length + 3).trim());
  }
  return m;
};
const annotationNotes = (who: string) => {
  const m = new Map<string, { label: string; notes: string }>();
  for (const kind of ['relation', 'total-scope']) {
    const rel = `annotation-${who}/${kind}-annotation-${who}.csv`;
    if (!exists(rel)) continue;
    for (const r of parseCsv(read(rel))) {
      const label = kind === 'relation'
        ? `${r.status}${r.parent_ref ? ` ${r.parent_ref}` : ''}`
        : `${r.scope_status}${r.direct_child_row_indices ? ` [${r.direct_child_row_indices}]` : ''}`;
      m.set(r.sample_id, { label, notes: r.notes });
    }
  }
  return m;
};
const decisions = { a: decisionLines(whoA), b: decisionLines(whoB) };
const refs = reference.map(who => ({ who, notes: annotationNotes(who) }));

const blocks = new Map<string, { rows: Record<string, string>[]; raw: string[] }>();
const block = (prefix: string) => {
  if (!blocks.has(prefix)) blocks.set(prefix, { rows: parseCsv(read(`annotation-input/${prefix}.rows.csv`)), raw: read(`annotation-input/${prefix}.raw.txt`).split('\n') });
  return blocks.get(prefix)!;
};
const cited = (label: string) => [...label.matchAll(/(?:row:)?(\d+)/gu)].map(m => Number(m[1]));
const amounts = (r: Record<string, string>) => AMOUNT_COLUMNS.map(c => Number(r[c] || 0));

const hint = (r: Record<string, string>, targetRow: Record<string, string> | undefined, rows: Record<string, string>[]) => {
  const out: string[] = [];
  const [ca, cb] = [r.candidate_a, r.candidate_b];
  const resolved = (x: string) => x.startsWith('RESOLVED');
  if (r.review_required_reason === 'CONTEXT_AUDIT') out.push('CONTEXT 行がブロックの根か（NO_PARENT）を確認する。');
  if (r.review_required_reason === 'AGREEMENT_AUDIT') out.push('2人の判定が一致した単位の監査。一致した判定に誤りがあれば、その層は全件レビュー（escalation）になる。');
  if (resolved(ca) && resolved(cb) && ca !== cb) out.push('2人が別々の親・範囲を RESOLVED にしている。どちらの候補も硬い制約（C0〜C5）を通るなら、候補が複数残っているので §4 により AMBIGUOUS。');
  if (resolved(ca) !== resolved(cb)) out.push('一方だけが RESOLVED。RESOLVED 側の根拠が、§4 の「禁止する決め手」（字下げ・コード幅・最も近い行・金額一致）だけに依っていないかを確認する。');
  if (r.unit_kind === 'TOTAL_SCOPE' && targetRow) {
    const total = amounts(targetRow).join(',');
    const single = [ca, cb].flatMap(cited).filter((n, i, a) => a.indexOf(n) === i)
      .map(n => rows.find(x => Number(x.row_index) === n)).filter(Boolean)
      .filter(x => amounts(x!).join(',') === total);
    if (single.length) out.push(`row ${single.map(x => x!.row_index).join(', ')} は単独で TOTAL と7セルとも同額。C3 により「単一の子で同額」はそれだけでは範囲の証拠にならない。`);
  }
  if (targetRow && amounts(targetRow).every(v => v === 0)) out.push('対象行は7セルとも0。金額は非判別的（NONDISC）。');
  return out;
};

const items = review.map(r => {
  const u = units.get(r.sample_id)!;
  const prefix = u.block_files.replace(/\.\*$/u, '');
  const { rows, raw } = block(prefix);
  const targetIndex = u.target_row_index === '' ? null : Number(u.target_row_index);
  const targetRow = targetIndex === null ? undefined : rows.find(x => Number(x.row_index) === targetIndex);
  const labels = [r.candidate_a, r.candidate_b, ...refs.map(x => x.notes.get(r.sample_id)?.label ?? '')];
  const citedRows = [...new Set(labels.flatMap(cited))].filter(n => rows.some(x => Number(x.row_index) === n));
  let lo = targetIndex ?? 1;
  let hi = targetIndex ?? Math.min(rows.length, 8);
  for (const n of citedRows) { lo = Math.min(lo, n); hi = Math.max(hi, n); }
  if (r.unit_kind === 'TOTAL_SCOPE' && targetIndex !== null) {
    const prevTotal = rows.filter(x => x.row_type === 'TOTAL' && Number(x.row_index) < targetIndex).pop();
    lo = Math.min(lo, prevTotal ? Number(prevTotal.row_index) : 1);
  }
  lo = Math.max(1, lo - 3);
  hi = Math.min(rows.length, hi + 3);
  const shown = rows.filter(x => Number(x.row_index) >= lo && Number(x.row_index) <= hi);
  const first = shown[0];
  const last = shown[shown.length - 1];
  const key = (p: string, l: string) => Number(p) * 100000 + Number(l);
  const hit = (x: Record<string, string> | undefined, k: number) =>
    !!x && k >= key(x.source_page, x.source_line_start) && k <= key(x.source_page, x.source_line_end);
  const mark = (k: number) => hit(targetRow, k) ? 'target' : shown.some(x => citedRows.includes(Number(x.row_index)) && hit(x, k)) ? 'cited' : '';
  const rawLines = raw.flatMap(line => {
    const m = line.match(/^p(\d+) L(\d+)\|/u);
    if (!m) return [];
    const k = key(m[1], m[2]);
    const inWindow = first && last && k >= key(first.source_page, first.source_line_start) - 2 && k <= key(last.source_page, last.source_line_end) + 1;
    return inWindow ? [{ text: line, mark: mark(k) }] : [];
  });
  const sums = r.unit_kind !== 'TOTAL_SCOPE' || !targetRow ? [] : labels.filter(l => l.startsWith('RESOLVED')).map(l => {
    const set = cited(l).map(n => rows.find(x => Number(x.row_index) === n)).filter(Boolean) as Record<string, string>[];
    const s = AMOUNT_COLUMNS.map((_, i) => set.reduce((acc, x) => acc + amounts(x)[i], 0));
    return { label: l, sum: s, total: amounts(targetRow), ok: s.every((v, i) => v === amounts(targetRow)[i]) };
  });
  return {
    review: r,
    unit: u,
    rows: shown.map(x => ({ ...x, cited: citedRows.includes(Number(x.row_index)), target: Number(x.row_index) === targetIndex })),
    rawLines,
    sums,
    decisions: { a: decisions.a.get(r.sample_id) ?? '', b: decisions.b.get(r.sample_id) ?? '' },
    refs: refs.map(x => ({ who: x.who, ...(x.notes.get(r.sample_id) ?? { label: '', notes: '' }) })),
    hints: hint(r, targetRow, rows),
  };
});

const columns = Object.keys(review[0]);
const data = { columns, items, annotators: { a: whoA, b: whoB }, amountColumns: AMOUNT_COLUMNS };
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>H1 GT human review</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;display:flex;height:100vh;color:#222}
#list{width:260px;overflow:auto;border-right:1px solid #ccc;font-size:13px}
#list div{padding:4px 8px;cursor:pointer;border-bottom:1px solid #eee}#list div.sel{background:#dbeafe}#list div.done{color:#888}
#main{flex:1;overflow:auto;padding:12px 18px}
pre{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#f7f7f7;padding:8px;overflow:auto;line-height:1.35}
table{border-collapse:collapse;font-size:12px}td,th{border:1px solid #ddd;padding:2px 6px;text-align:right;white-space:nowrap}td.l{text-align:left}
tr.target,span.target{background:#fde68a}tr.cited,span.cited{background:#dcfce7}.box{border:1px solid #ccc;border-radius:6px;padding:8px;margin:8px 0}
.hint{display:none;background:#fff7ed}.showhints .hint{display:block}.ok{color:#15803d}.ng{color:#b91c1c}
label{margin-right:12px}input[type=text]{width:420px}textarea{width:100%;height:48px}
</style></head><body>
<div id="list"></div><div id="main"></div>
<script>
const D=${JSON.stringify(data).replace(/</gu, '\\u003c')};
const KEY='h1-gt-human-review-v1';
const saved=JSON.parse(localStorage.getItem(KEY)||'{}');
for(const it of D.items){const s=saved[it.review.sample_id];if(s)Object.assign(it.review,s);}
let cur=0,filter='required';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const visible=()=>D.items.map((it,i)=>[it,i]).filter(([it])=>filter==='all'||(filter==='required'?it.review.review_required_reason:!it.review.human_review_status&&it.review.review_required_reason));
function save(){const o={};for(const it of D.items){const r=it.review;if(r.human_decision||r.human_parent_or_scope||r.human_notes||r.human_review_status)o[r.sample_id]={human_decision:r.human_decision,human_parent_or_scope:r.human_parent_or_scope,human_notes:r.human_notes,human_review_status:r.human_review_status};}localStorage.setItem(KEY,JSON.stringify(o));}
function list(){const v=visible();const done=D.items.filter(it=>it.review.review_required_reason&&it.review.human_review_status==='REVIEWED').length;const req=D.items.filter(it=>it.review.review_required_reason).length;
document.getElementById('list').innerHTML='<div><select id=f><option value=required>要レビュー</option><option value=todo>未完了</option><option value=all>全146</option></select> '+done+'/'+req+'<br><button id=exp>CSVを書き出す</button> <button id=hb>示唆の表示切替</button></div>'+v.map(([it,i])=>'<div data-i='+i+' class="'+(i===cur?'sel ':'')+(it.review.human_review_status?'done':'')+'">'+esc(it.review.sample_id)+' '+esc(it.review.review_required_reason||'-')+'</div>').join('');
const f=document.getElementById('f');f.value=filter;f.onchange=e=>{filter=e.target.value;list();};
document.getElementById('exp').onclick=exportCsv;document.getElementById('hb').onclick=()=>document.body.classList.toggle('showhints');
for(const d of document.querySelectorAll('#list div[data-i]'))d.onclick=()=>{cur=+d.dataset.i;render();};}
function render(){const it=D.items[cur],r=it.review;
const rows='<table><tr><th>row</th><th>type</th><th>code</th><th class=l>name</th><th>p</th><th>L</th>'+D.amountColumns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr>'+it.rows.map(x=>'<tr class="'+(x.target?'target':x.cited?'cited':'')+'"><td>'+esc(x.row_index)+'</td><td class=l>'+esc(x.row_type)+'</td><td class=l>'+esc(x.code_raw)+'</td><td class=l>'+esc(x.name_compact)+'</td><td>'+esc(x.source_page)+'</td><td>'+esc(x.source_line_start)+'</td>'+D.amountColumns.map(c=>'<td>'+Number(x[c]||0).toLocaleString()+'</td>').join('')+'</tr>').join('')+'</table>';
const sums=it.sums.map(s=>'<div class="'+(s.ok?'ok':'ng')+'">'+esc(s.label)+': 直接の子の合計 '+(s.ok?'＝':'≠')+' TOTAL ['+s.sum.join(', ')+'] / ['+s.total.join(', ')+']</div>').join('');
document.getElementById('main').innerHTML='<h2>'+esc(r.sample_id)+' <small>'+esc(r.unit_kind)+' / '+esc(r.stratum)+' / '+esc(r.review_required_reason||'レビュー不要')+'</small></h2>'
+'<div>'+esc(r.table_block_id)+'　<b>対象: '+esc(r.target)+'</b></div>'
+'<div class=box><b>'+esc(D.annotators.a)+'</b>: '+esc(r.candidate_a)+'<br><small>'+esc(it.decisions.a)+'</small><br><b>'+esc(D.annotators.b)+'</b>: '+esc(r.candidate_b)+'<br><small>'+esc(it.decisions.b)+'</small>'+(sums?'<div style="margin-top:6px">'+sums+'</div>':'')+'</div>'
+'<details><summary>参考: round 1（GT 候補ではない）</summary>'+it.refs.map(x=>'<div><b>'+esc(x.who)+'</b>: '+esc(x.label)+' — <small>'+esc(x.notes)+'</small></div>').join('')+'</details>'
+'<div class="box hint"><b>Coordinator の示唆（参考。判定は raw text と契約で行う）</b><ul>'+(it.hints.length?it.hints.map(h=>'<li>'+esc(h)+'</li>').join(''):'<li>特になし</li>')+'</ul></div>'
+'<h3>raw text（黄＝対象行、緑＝注釈が挙げた行）</h3><pre>'+it.rawLines.map(l=>l.mark?'<span class='+l.mark+'>'+esc(l.text)+'</span>':esc(l.text)).join('\\n')+'</pre>'+rows
+'<div class=box><b>判定</b><br>'+(r.unit_kind==='TOTAL_SCOPE'?['RESOLVED','AMBIGUOUS']:['RESOLVED','AMBIGUOUS','NO_PARENT','NOT_APPLICABLE']).map(v=>'<label><input type=radio name=d value='+v+(r.human_decision===v?' checked':'')+'>'+v+'</label>').join('')
+'<br>親 / 範囲（RESOLVED のとき。RELATION は context か row:N、TOTAL は直接の子を ; 区切り）<br><input type=text id=p value="'+esc(r.human_parent_or_scope)+'">'
+'<br>根拠<br><textarea id=n>'+esc(r.human_notes)+'</textarea><br><label><input type=checkbox id=s'+(r.human_review_status==='REVIEWED'?' checked':'')+'> REVIEWED</label> <button id=nx>保存して次へ</button></div>'
+'<details><summary>契約の要点（§3・§4）</summary><pre>C1 親は対象行より前。C2 TOTAL で閉じた範囲をまたいで親候補を引き継がない。\\nC3 TOTAL の範囲: 直接の子だけの7セル合計が一致する範囲。複数の範囲が満たせば AMBIGUOUS。単一の子で同額はそれだけでは証拠にしない。\\nC4 合計は直接の子だけ（DETAIL とその下の CODE3 を同時に足さない）。C5 ページ境界は階層の境界ではない。\\nC6 書式は証拠に使ってよいが、コード幅だけで役割を決めない。C7 字下げは補助証拠だけ。\\n§4 RESOLVED は硬い制約の後で候補がちょうど1つのときだけ。\\n禁止する決め手（単独では不可）: 字下げが浅い方／コード幅／最も近い行／金額が一致する方／府省別の規則。</pre></details>';
const upd=()=>{const d=document.querySelector('input[name=d]:checked');r.human_decision=d?d.value:'';r.human_parent_or_scope=document.getElementById('p').value.trim();r.human_notes=document.getElementById('n').value.trim();r.human_review_status=document.getElementById('s').checked?'REVIEWED':'';save();};
for(const e of document.querySelectorAll('#main input,#main textarea'))e.onchange=()=>{upd();list();};
document.getElementById('nx').onclick=()=>{upd();const v=visible().map(([,i])=>i);const k=v.indexOf(cur);cur=v[k+1]??cur;render();};
list();}
function exportCsv(){const cell=v=>{v=String(v??'');return /[",\\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
const text=[D.columns.join(','),...D.items.map(it=>D.columns.map(c=>cell(it.review[c])).join(','))].join('\\n')+'\\n';
const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv'}));a.download='human-review.csv';a.click();}
const first=visible()[0];if(first)cur=first[1];render();
</script></body></html>
`;
fs.writeFileSync(path.join(root, 'review/human-review.html'), html);
console.log(JSON.stringify({ output: path.join(root, 'review/human-review.html'), units: items.length, required: items.filter(i => i.review.review_required_reason).length, withHints: items.filter(i => i.hints.length).length }, null, 2));
