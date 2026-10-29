'use client';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Crosshair, LoaderCircle, Radio, Shield, Swords } from 'lucide-react';
import Minimap from '@/components/minimap';
import Portrait from '@/components/portrait';
import { api, SIDE_NAMES } from '@/lib/api';
import { DEFAULT_LOADOUT, OPPONENT_PRESETS, PERSONALITIES, PERSONAS, SQUAD_ROLES, TOOL_SLOTS, TOOLS } from '@/lib/catalog';
import { Battle, BIOMES, Biome, DEFAULT_PROMPTS, Role, ROLES, Side, Terrain, previewUnits } from '@/lib/types';

const ICONS={scout:Radio,vanguard:Crosshair,support:Shield};
const MOCK=<span className="mock-tag" title="규칙 설계 전 목업입니다. 선택해도 경기에 반영되지 않습니다.">목업, 설계 예정</span>;
type Slot={role:Role;personality:string;tools:string[]};

export default function Draft({searchParams}:{searchParams:Promise<{seed?:string;biome?:string;mode?:string}>}){
  const query=use(searchParams);const router=useRouter();
  const seed=Number(query.seed),biome=(query.biome&&query.biome in BIOMES?query.biome:'woodland') as Biome,mode=query.mode==='live'?'live':'rehearsal';
  const [field,setField]=useState<Terrain|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [side,setSide]=useState<Side>('cyan'),[persona,setPersona]=useState(PERSONAS[2].id),[opponent,setOpponent]=useState(OPPONENT_PRESETS[0].id);
  const [slots,setSlots]=useState<Slot[]>(()=>SQUAD_ROLES.map((role,i)=>({role,personality:PERSONALITIES[[0,1,2][i]].id,tools:DEFAULT_LOADOUT[role]})));
  const [orders,setOrders]=useState<Record<Side,string>>({...DEFAULT_PROMPTS});
  const enemy:Side=side==='cyan'?'amber':'cyan';const preset=OPPONENT_PRESETS.find(p=>p.id===opponent)!;

  useEffect(()=>{if(!Number.isInteger(seed)){setError('경기 설정에서 전장을 먼저 고르세요.');return;}api<Terrain>('terrain','POST',{seed,biome}).then(setField).catch(e=>setError(e.message));},[seed,biome]);
  const update=(i:number,patch:Partial<Slot>)=>setSlots(s=>s.map((slot,k)=>k===i?{...slot,...patch}:slot));
  function toggleTool(i:number,id:string){const slot=slots[i];if(slot.tools.includes(id))update(i,{tools:slot.tools.filter(t=>t!==id)});else if(slot.tools.length<TOOL_SLOTS)update(i,{tools:[...slot.tools,id]});}
  async function deploy(){
    if(!field||busy)return;setBusy(true);setError('');
    try{const b=await api<Battle>('battles','POST',{seed:field.seed,biome:field.biome,mode,[`${side}_prompt`]:orders[side],[`${enemy}_prompt`]:preset.strategy[enemy]});router.push(`/battle/${b.id}?side=${side}`);}
    catch(e){setError(e instanceof Error?e.message:'경기를 만들 수 없습니다.');setBusy(false);}
  }

  return <main className={`draft ${side}`}>
    <header className="draft-head">
      <button type="button" className="text-button" onClick={()=>router.push('/')}><ArrowLeft size={16}/>경기 설정</button>
      <h1>에이전트 선택</h1>
      <ol className="steps" aria-label="진행 단계"><li><b>1</b>경기 설정</li><li aria-current="step"><b>2</b>에이전트 선택</li></ol>
      <span className="draft-meta">{field?<><span>{field.name}</span><span>{BIOMES[field.biome].ko}</span><span>시드 <b className="num">{field.seed}</b></span><span>{mode==='live'?'실제 모델':'엔진 테스트'}</span></>:'전장 불러오는 중…'}</span>
    </header>

    <div className="draft-grid">
      <section className="draft-col">
        <h2 className="section-title"><span>진영</span></h2>
        <div className="side-pick">{(['cyan','amber'] as Side[]).map(s=><button key={s} className={`${s} ${side===s?'selected':''}`} aria-pressed={side===s} onClick={()=>setSide(s)}><strong>{SIDE_NAMES[s]}</strong><small>{s==='cyan'?'남서 기지':'북동 기지'}</small></button>)}</div>
        <h2 className="section-title"><span>사령관 페르소나</span>{MOCK}</h2>
        <div className="persona-list">{PERSONAS.map(p=><button key={p.id} className={`persona-card ${persona===p.id?'selected':''}`} aria-pressed={persona===p.id} onClick={()=>setPersona(p.id)}>
          <Portrait side={side} commander/><span><strong>{p.name}</strong><em>{p.title}</em><small>{p.voice}</small></span>{persona===p.id&&<Check size={14} className="persona-check"/>}
        </button>)}</div>
      </section>

      <section className="draft-col squad-col">
        <h2 className="section-title"><span>하위 에이전트</span>{MOCK}<small>도구 슬롯 {TOOL_SLOTS}개</small></h2>
        <div className="slot-list">{slots.map((slot,i)=>{const Icon=ICONS[slot.role];return <article key={i} className="slot-card">
          <div className="slot-head"><Portrait side={side} role={slot.role}/><div><h3>{ROLES[slot.role].name}<Icon size={14} aria-hidden="true"/></h3><small>유닛 <span className="num">{i+1}</span></small></div></div>
          <ul className="slot-traits">{ROLES[slot.role].detail.split(' · ').map(d=><li key={d}>{d}</li>)}</ul>
          <div className="slot-row" role="group" aria-label="역할"><span>역할</span><div className="chips">{SQUAD_ROLES.map(r=><button key={r} className={slot.role===r?'selected':''} aria-pressed={slot.role===r} onClick={()=>update(i,{role:r,tools:slot.tools.filter(t=>!TOOLS.find(x=>x.id===t)?.roles||TOOLS.find(x=>x.id===t)!.roles!.includes(r))})}>{ROLES[r].ko}</button>)}</div></div>
          <div className="slot-row" role="group" aria-label="성격"><span>성격</span><div className="chips">{PERSONALITIES.map(p=><button key={p.id} className={slot.personality===p.id?'selected':''} aria-pressed={slot.personality===p.id} title={p.trait} onClick={()=>update(i,{personality:p.id})}>{p.name}</button>)}</div></div>
          <div className="slot-row" role="group" aria-label="도구"><span>도구 <b className="num">{slot.tools.length}/{TOOL_SLOTS}</b></span><div className="chips tools">{TOOLS.map(t=>{const blocked=!!t.roles&&!t.roles.includes(slot.role);const on=slot.tools.includes(t.id);return <button key={t.id} className={`${on?'selected':''} ${t.live?'':'planned'}`} aria-pressed={on} disabled={blocked||(!on&&slot.tools.length>=TOOL_SLOTS)} title={`${t.detail}${t.live?'':' (예정)'}`} onClick={()=>toggleTool(i,t.id)}>{t.name}</button>;})}</div></div>
        </article>;})}</div>
      </section>

      <section className="draft-col">
        <h2 className="section-title"><span>상대 {SIDE_NAMES[enemy]}</span><small>프리셋 전략이 상대 사령관 지시로 쓰입니다</small></h2>
        <div className="preset-list">{OPPONENT_PRESETS.map(p=><button key={p.id} className={`preset-card ${opponent===p.id?'selected':''}`} aria-pressed={opponent===p.id} onClick={()=>setOpponent(p.id)}><strong>{p.name}<em>{p.persona}</em></strong><small>{p.strategy[enemy]}</small></button>)}</div>
        <h2 className="section-title"><span>첫 작전 지시</span><small>사령관에게 전달</small></h2>
        <textarea className="order-input" aria-label="첫 작전 지시" maxLength={1200} value={orders[side]} onChange={e=>setOrders(o=>({...o,[side]:e.target.value}))}/>
        {field&&<div className="draft-map"><Minimap field={field} units={previewUnits(field)} owners={{}} selected="" side={side} fog={false} round={0} onSelect={()=>{}}/></div>}
      </section>
    </div>

    <footer className="draft-foot">
      {error?<span className="field-error" role="alert">{error}</span>:<span>목업 항목(페르소나, 역할, 성격, 도구)은 아직 경기에 반영되지 않습니다. 진영, 상대 프리셋, 첫 지시는 반영됩니다.</span>}
      <button className="primary-button" disabled={!field||busy||!orders[side].trim()} onClick={()=>void deploy()}>{busy?<LoaderCircle className="spin" size={16}/>:<Swords size={16}/>}출전<ArrowRight size={16}/></button>
    </footer>
  </main>;
}
