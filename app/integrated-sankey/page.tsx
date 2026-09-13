'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import type { IntegratedGraph, IntegratedItemEdge, IntegratedProjectNode, IntegratedSectionNode } from '@/app/lib/integrated-sankey';

const money = (v:number) => v >= 1e12 ? `${(v/1e12).toFixed(2)}兆円` : v >= 1e8 ? `${(v/1e8).toFixed(1)}億円` : `${Math.round(v/1e4).toLocaleString()}万円`;
const trim = (s:string,n=28) => s.length>n ? `${s.slice(0,n)}…` : s;
type DisplayNode = { id:string; name:string; value:number; side:'left'|'right'; source?:IntegratedSectionNode; project?:IntegratedProjectNode; kind:'section'|'project'|'unconnected'|'other'|'excess' };
type DisplayEdge = IntegratedItemEdge & { displayTarget:string };

function buildView(data:IntegratedGraph, limit:number, query:string) {
  const q=query.trim().toLowerCase();
  const matchingSectionIds=new Set(data.sections.filter(s=>!q||`${s.name} ${s.ministry} ${s.organization}`.toLowerCase().includes(q)).map(s=>s.id));
  const matchingProjectIds=new Set(data.projects.filter(p=>!q||`${p.name} ${p.ministry} ${p.projectId}`.toLowerCase().includes(q)).map(p=>p.id));
  let sections=data.sections.filter(s=>!q||matchingSectionIds.has(s.id)||data.edges.some(e=>e.source===s.id&&matchingProjectIds.has(e.target)));
  sections=sections.sort((a,b)=>b.amount-a.amount).slice(0,limit);
  const sectionIds=new Set(sections.map(s=>s.id));
  const candidateEdges=data.edges.filter(e=>sectionIds.has(e.source));
  const connectedTotals=new Map<string,number>();
  for(const e of candidateEdges) if(e.target.startsWith('project:')) connectedTotals.set(e.target,(connectedTotals.get(e.target)||0)+e.value);
  let projects=data.projects.filter(p=>connectedTotals.has(p.id)&&(!q||matchingProjectIds.has(p.id)||candidateEdges.some(e=>e.target===p.id&&matchingSectionIds.has(e.source))));
  if(!q) projects=projects.sort((a,b)=>(connectedTotals.get(b.id)||0)-(connectedTotals.get(a.id)||0)).slice(0,limit);
  else projects=projects.slice(0,Math.max(limit,60));
  const projectIds=new Set(projects.map(p=>p.id));
  const edges:DisplayEdge[]=candidateEdges.map(e=>({...e,displayTarget:e.target.startsWith('project:')&&!projectIds.has(e.target)?'other-projects':e.target}));
  const left:DisplayNode[]=sections.map(s=>({id:s.id,name:s.name,value:edges.filter(e=>e.source===s.id&&e.status!=='excess').reduce((a,e)=>a+e.value,0),side:'left',source:s,kind:'section'}));
  const right:DisplayNode[]=projects.map(p=>({id:p.id,name:p.name,value:edges.filter(e=>e.displayTarget===p.id).reduce((a,e)=>a+e.value,0),side:'right',project:p,kind:'project'}));
  const special:[string,string,'unconnected'|'other'|'excess'][]=[['rs-unconnected','RS未接続','unconnected'],['other-projects','その他のRS事業','other'],['rs-excess','超過・要確認','excess']];
  for(const [id,name,kind] of special){const value=edges.filter(e=>e.displayTarget===id).reduce((a,e)=>a+e.value,0);if(value>0)right.push({id,name,value,side:'right',kind});}
  return {left,right,edges};
}

function App(){
  const [data,setData]=useState<IntegratedGraph|null>(null); const [error,setError]=useState('');
  const [limit,setLimit]=useState(35); const [query,setQuery]=useState(''); const [selected,setSelected]=useState<string|null>(null);
  const [hover,setHover]=useState<IntegratedItemEdge|null>(null); const [scale,setScale]=useState(0.8); const [pan,setPan]=useState({x:0,y:0});
  const drag=useRef<{x:number;y:number;px:number;py:number}|null>(null);
  useEffect(()=>{fetch('/api/integrated-sankey?year=2025').then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);return j}).then(setData).catch(e=>setError(e.message))},[]);
  const view=useMemo(()=>data?buildView(data,limit,query):null,[data,limit,query]);
  const layout=useMemo(()=>{
    if(!view)return null; const H=Math.max(1050,Math.max(view.left.length,view.right.length)*30+80), xL=120,xR=1180,w=230;
    const place=(nodes:DisplayNode[])=>{const total=nodes.reduce((a,n)=>a+Math.sqrt(Math.max(1,n.value)),0);let y=40;return new Map(nodes.map(n=>{const h=Math.max(12,Math.sqrt(Math.max(1,n.value))/total*(H-nodes.length*8-80));const p={...n,x:n.side==='left'?xL:xR,y,h};y+=h+8;return[n.id,p]}));};
    return {H,left:place(view.left),right:place(view.right),xL,xR,w};
  },[view]);
  const selectedNode=data?.sections.find(n=>n.id===selected)||data?.projects.find(n=>n.id===selected);
  const selectedEdges=data?.edges.filter(e=>e.source===selected||e.target===selected)||[];
  if(error)return <div className="flex h-screen items-center justify-center text-red-600">{error}</div>;
  if(!data||!view||!layout)return <div className="flex h-screen items-center justify-center text-neutral-500">読み込み中…</div>;
  const isRelated=(e:DisplayEdge)=>!selected||e.source===selected||e.target===selected||e.displayTarget===selected;
  return <main className="fixed inset-0 overflow-hidden bg-[#f7f8f5] text-neutral-800">
    <header className="absolute left-4 right-4 top-4 z-30 flex items-start justify-between gap-4 pointer-events-none">
      <div className="pointer-events-auto rounded-2xl border border-black/10 bg-white/95 p-4 shadow-lg backdrop-blur">
        <div className="flex items-center gap-3"><PageNavMenu current="/integrated-sankey" theme="light"/><div><h1 className="text-lg font-bold">MOF項 × RS事業</h1><p className="text-xs text-neutral-500">目をエッジとして結ぶファーストカット（2024年度当初予算）</p></div></div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs"><span>MOF {money(data.metadata.mofAmount)}</span><span className="text-emerald-700">接続 {money(data.metadata.connectedAmount)}</span><span className="text-neutral-500">RS未接続 {money(data.metadata.unconnectedAmount)}</span>{data.metadata.excessAmount>0&&<span className="text-rose-600">超過 {money(data.metadata.excessAmount)}</span>}</div>
      </div>
      <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-black/10 bg-white/95 p-2 shadow-lg">
        <input data-testid="search-input" value={query} onChange={e=>{setQuery(e.target.value);setSelected(null)}} placeholder="項・事業を検索" className="w-56 rounded-lg border px-3 py-2 text-sm"/>
        <select aria-label="表示件数" value={limit} onChange={e=>setLimit(Number(e.target.value))} className="rounded-lg border px-2 py-2 text-sm"><option value={25}>上位25</option><option value={35}>上位35</option><option value={50}>上位50</option></select>
        <button data-testid="zoom-out" onClick={()=>setScale(s=>Math.max(.25,s-.1))} className="h-9 w-9 rounded-lg border">−</button><button data-testid="zoom-in" onClick={()=>setScale(s=>Math.min(2,s+.1))} className="h-9 w-9 rounded-lg border">＋</button><button onClick={()=>{setScale(.8);setPan({x:0,y:0})}} className="rounded-lg border px-3 py-2 text-xs">全体</button>
      </div>
    </header>
    <div className="absolute left-5 top-40 z-20 rounded-lg bg-white/90 px-3 py-2 text-xs shadow"><b>MOFの項</b><span className="ml-[850px]"><b>RSの事業</b></span></div>
    <svg data-testid="integrated-canvas" className="h-full w-full cursor-grab" viewBox="0 0 1560 1050" onWheel={e=>{e.preventDefault();setScale(s=>Math.max(.25,Math.min(2,s*(e.deltaY>0 ? .9 : 1.1))))}} onMouseDown={e=>{drag.current={x:e.clientX,y:e.clientY,px:pan.x,py:pan.y}}} onMouseMove={e=>{if(drag.current)setPan({x:drag.current.px+e.clientX-drag.current.x,y:drag.current.py+e.clientY-drag.current.y})}} onMouseUp={()=>drag.current=null} onMouseLeave={()=>drag.current=null}>
      <g transform={`translate(${pan.x} ${pan.y+150}) scale(${scale})`}>
        {view.edges.map((e,i)=>{const a=layout.left.get(e.source),b=layout.right.get(e.displayTarget);if(!a||!b)return null;const active=isRelated(e);const width=Math.max(1.2,Math.min(42,Math.sqrt(e.value/1e8)*1.6));const color=e.status==='connected'?'#61a98a':e.status==='excess'?'#dc5a70':'#aab0aa';return <path key={`${e.id}-${i}`} data-testid="integrated-edge" d={`M${a.x+layout.w},${a.y+a.h/2} C${a.x+560},${a.y+a.h/2} ${b.x-330},${b.y+b.h/2} ${b.x},${b.y+b.h/2}`} fill="none" stroke={color} strokeWidth={width} strokeOpacity={active ? 0.48 : 0.07} onMouseEnter={()=>setHover(e)} onMouseLeave={()=>setHover(null)} onClick={()=>setSelected(e.target)} className="cursor-pointer"/>})}
        {[...layout.left.values(),...layout.right.values()].map(n=>{const active=!selected||n.id===selected||view.edges.some(e=>isRelated(e)&&(e.source===n.id||e.displayTarget===n.id));const fill=n.kind==='section'?(n.source?.accountType==='general'?'#317d52':'#456d9c'):n.kind==='project'?'#d8873b':n.kind==='excess'?'#c8465b':'#777d78';return <g key={n.id} data-testid="sankey-node" onClick={()=>setSelected(selected===n.id?null:n.id)} className="cursor-pointer" opacity={active?1:.18}><rect x={n.x} y={n.y} width={layout.w} height={Math.max(12,n.h)} rx="4" fill={fill} stroke={selected===n.id?'#111':'white'} strokeWidth={selected===n.id?3:1}/><text x={n.side==='left'?n.x+8:n.x+layout.w-8} y={n.y+Math.max(12,n.h)/2+4} textAnchor={n.side==='left'?'start':'end'} fill="white" fontSize="12" fontWeight="600">{trim(n.name)}</text><title>{n.name}｜{money(n.value)}</title></g>})}
      </g>
    </svg>
    {hover&&<div data-testid="integrated-hover" className="pointer-events-none absolute bottom-5 left-5 z-40 max-w-md rounded-xl bg-neutral-900/95 p-3 text-xs text-white shadow-xl"><div className="font-bold">目：{hover.itemName}</div><div className="mt-1">このエッジ {money(hover.value)} ／ MOF目 {money(hover.mofAmount)}</div><div className="mt-1 text-neutral-300">{hover.status==='connected'?'MOF接続済み':hover.status==='excess'?'超過・要確認':'RS未接続・差額'}</div></div>}
    {selected&&<aside data-testid="integrated-detail" className="absolute bottom-4 right-4 top-28 z-30 w-[420px] overflow-auto rounded-2xl border border-black/10 bg-white/95 p-5 shadow-2xl backdrop-blur"><button onClick={()=>setSelected(null)} className="float-right rounded border px-2 py-1 text-xs">閉じる</button>{selectedNode?<><p className="text-xs font-semibold text-neutral-500">{'projectId'in selectedNode?'RS予算事業':'MOF項'}</p><h2 className="mt-1 pr-10 text-lg font-bold">{selectedNode.name}</h2>{'projectId'in selectedNode?<ProjectDetail project={selectedNode}/>:<SectionDetail section={selectedNode} edges={selectedEdges}/>}</>:<SpecialDetail id={selected} edges={selectedEdges}/>}</aside>}
  </main>;
}

function SectionDetail({section,edges}:{section:IntegratedSectionNode;edges:IntegratedItemEdge[]}){return <div className="mt-4 space-y-4 text-sm"><div className="rounded-xl bg-neutral-100 p-3"><div>{section.ministry} / {section.organization}{section.subAccount?` / ${section.subAccount}`:''}</div><div className="mt-2 font-bold">MOF項額 {money(section.amount)}</div><div className="text-xs text-neutral-500">目 {section.itemCount}件</div></div><div><h3 className="mb-2 font-bold">目エッジ</h3>{edges.sort((a,b)=>b.value-a.value).slice(0,80).map(e=><div key={e.id} className="border-t py-2"><div className="font-medium">{e.itemName}</div><div className="text-xs text-neutral-500">{money(e.value)}・{e.status==='connected'?'RS接続済み':e.status==='excess'?'超過・要確認':'RS未接続'}</div></div>)}</div></div>}
function ProjectDetail({project}:{project:IntegratedProjectNode}){return <div className="mt-4 text-sm"><div className="rounded-xl bg-orange-50 p-3"><div>{project.ministry}・事業ID {project.projectId}</div><div className="mt-2">MOF接続済み <b>{money(project.linkedAmount)}</b></div><div>RS当初予算 <b>{money(project.initialBudget)}</b></div><div>MOF未接続差額 <b>{money(project.mofUnlinkedAmount)}</b></div></div><h3 className="mb-2 mt-5 font-bold">目</h3>{project.budgetItems.length===0?<p className="text-neutral-500">目内訳がありません</p>:project.budgetItems.map((i,n)=><div key={`${i.item}-${i.subItem}-${n}`} className="border-t py-2"><div className="flex gap-2"><span className={`rounded px-1.5 py-0.5 text-[10px] ${i.connected?'bg-emerald-100 text-emerald-800':'bg-neutral-200 text-neutral-700'}`}>{i.connected?'MOF接続済み':'MOF未接続'}</span><span>{i.subItem||i.item}</span></div><div className="mt-1 text-xs text-neutral-500">{i.accountCategory} / {i.item} / {money(i.amount)}</div></div>)}</div>}
function SpecialDetail({id,edges}:{id:string;edges:IntegratedItemEdge[]}){const title=id==='rs-unconnected'?'RS未接続':id==='rs-excess'?'超過・要確認':'その他のRS事業';return <div className="mt-4 text-sm"><h2 className="text-lg font-bold">{title}</h2><p className="mt-2 text-neutral-600">{id==='rs-unconnected'?'MOFの目金額のうち、RS事業への接続で説明されない部分です。制度上の対象外とは断定していません。':'集約または確認が必要なエッジです。'}</p>{edges.sort((a,b)=>b.value-a.value).slice(0,100).map(e=><div key={e.id} className="border-t py-2"><div>{e.itemName}</div><div className="text-xs text-neutral-500">{money(e.value)}</div></div>)}</div>}
export default function IntegratedSankeyPage(){return <App/>}
