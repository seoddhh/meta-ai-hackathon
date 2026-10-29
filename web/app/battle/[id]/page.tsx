'use client';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { use, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Crosshair, Eye, EyeOff, Flag, Focus, ImagePlus, Layers, LoaderCircle, LocateFixed, Maximize, Pause, Play, Radio, Send, Shield, Shuffle, SkipForward, Sparkles, X } from 'lucide-react';
import Minimap from '@/components/minimap';
import Portrait from '@/components/portrait';
import { api, SIDE_NAMES } from '@/lib/api';
import { cameraBus } from '@/lib/camera';
import { TOOLS } from '@/lib/catalog';
import { BEACONS, Battle, BIOMES, Config, DEFAULT_PROMPTS, Frame, Point, Role, ROLES, RULES, Side, previewUnits, sensorRange } from '@/lib/types';

const Arena=dynamic(()=>import('@/components/arena'),{ssr:false,loading:()=> <div className="scene-fallback">전장 렌더러 준비 중…</div>});
const ICONS={scout:Radio,vanguard:Crosshair,support:Shield};
const LIVE_TOOLS=TOOLS.filter(t=>t.live);

export default function BattlePage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{side?:string}>}){
  const {id}=use(params);const query=use(searchParams);const router=useRouter();
  const side:Side=query.side==='amber'?'amber':'cyan';
  const [config,setConfig]=useState<Config|null>(null),[battle,setBattle]=useState<Battle|null>(null),[missing,setMissing]=useState('');
  const [selected,setSelected]=useState(`${side}-commander`),[prompts,setPrompts]=useState<Record<Side,string>>({...DEFAULT_PROMPTS}),[unitPrompts,setUnitPrompts]=useState<Record<string,string>>({});
  const [frameIndex,setFrameIndex]=useState<number|null>(null),[busy,setBusy]=useState(false),[running,setRunning]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const [showResult,setShowResult]=useState(false),[resetCamera,setResetCamera]=useState(0),[showFeed,setShowFeed]=useState(true),[fog,setFog]=useState(false),[dirtyTargets,setDirtyTargets]=useState<string[]>([]);
  const runner=useRef(0),busyRef=useRef(false),current=useRef<Battle|null>(null),dialogRef=useRef<HTMLElement>(null);
  const accept=(b:Battle)=>{current.current=b;setBattle(b);setFrameIndex(null);};

  useEffect(()=>{Promise.all([api<Config>('config'),api<Battle>(`battles/${id}`)]).then(([c,b])=>{setConfig(c);accept(b);setPrompts({...b.prompts});setUnitPrompts({...b.unit_prompts});}).catch(e=>setMissing(e.message));return()=>{runner.current++;};},[id]);

  const field=battle?.field||null;
  const frame:Frame|null=battle?(frameIndex===null?battle:battle.frames[frameIndex]):null;
  const units=frame?.units||(field?previewUnits(field):[]),own=units.filter(u=>u.side===side),focused=units.find(u=>u.id===selected),isCommander=selected.endsWith('-commander');
  const canCommand=selected.startsWith(side)&&(!focused||focused.hp>0),scores=frame?.scores||{cyan:0,amber:0},owners=frame?.owners||{};
  const round=frame?.round||0,isFinished=battle?.status==='finished',isReplay=frameIndex!==null&&frameIndex!==(battle?.frames.length||1)-1,draftDirty=dirtyTargets.length>0;
  const prompt=isCommander?prompts[side]:unitPrompts[selected]||'';
  const targetName=isCommander?'SPARK':focused?ROLES[focused.role].name:'AGENT';
  const events=(battle?.events||[]).filter(e=>e.round<=round&&['move','capture','pulse','repair','scan','disabled','rejected','blocked'].includes(e.kind)).slice(-5).reverse();
  const tasks=frameIndex===null?battle?.assignments[side]||[]:frame?.events.filter(e=>e.kind==='task'&&e.side===side).map(e=>({unit_id:e.unit_id||'',objective:'',instruction:e.message}))||[];
  const unitTask=tasks.find(a=>a.unit_id===selected);
  const commandSignal=frameIndex===null?battle?.commands[side]:frame?.events.find(e=>e.kind==='command'&&e.side===side)?.message;
  const lastTool=(battle?.events||[]).filter(e=>e.round<=round&&e.kind==='tool'&&e.unit_id===selected).at(-1);

  async function perform(action:()=>Promise<void>){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'알 수 없는 오류');}finally{busyRef.current=false;setBusy(false);}}
  async function nextRound(){if(draftDirty||isReplay)return;await perform(async()=>{const b=current.current;if(!b||b.status==='finished')return;const next=await api<Battle>(`battles/${b.id}/advance`,'POST',{expected_round:b.round});accept(next);if(next.status==='finished')setShowResult(true);});}
  async function play(){if(running){runner.current++;setRunning(false);return;}if(draftDirty||isReplay||isFinished)return;await perform(async()=>{const token=++runner.current;setRunning(true);try{let b=current.current;while(b&&token===runner.current&&b.status!=='finished'){b=await api<Battle>(`battles/${b.id}/advance`,'POST',{expected_round:b.round});accept(b);await new Promise(r=>setTimeout(r,850));}if(b?.status==='finished')setShowResult(true);}finally{setRunning(false);}});}
  function locate(target:string):Point|null{if(!field)return null;if(target.endsWith('-commander'))return field.bases[target.split('-')[0] as Side];const u=units.find(u=>u.id===target&&u.hp>0);return u?[u.x,u.y]:null;}
  function selectUnit(target:string,focus=false){setSelected(target);setSaved(false);const p=focus?locate(target):null;if(p)cameraBus.focus(p);}
  function updatePrompt(value:string){if(isCommander)setPrompts(p=>({...p,[side]:value}));else setUnitPrompts(p=>({...p,[selected]:value}));setDirtyTargets(keys=>keys.includes(selected)?keys:[...keys,selected]);setSaved(false);}
  async function saveStrategy(){if(!prompt.trim()||!canCommand)return;await perform(async()=>{if(current.current)accept(await api<Battle>(`battles/${current.current.id}/strategy`,'PATCH',{side,prompt,unit_id:isCommander?null:selected}));setSaved(true);setDirtyTargets(keys=>keys.filter(k=>k!==selected));});}
  async function makeImage(){await perform(async()=>{if(current.current)accept(await api<Battle>(`battles/${current.current.id}/image`,'POST',{}));});}

  useEffect(()=>{function key(e:KeyboardEvent){if(e.key==='Escape'){setShowResult(false);return;}if((e.target as HTMLElement)?.closest('input,textarea,select'))return;if(showResult)return;if(e.key===' '&&(e.target as HTMLElement)?.closest('button'))return;const k=e.key.toLowerCase();if(e.key===' '){e.preventDefault();void play();}if(k==='n'&&!busy)void nextRound();if(k==='r')setResetCamera(v=>v+1);if(k==='v')setFog(v=>!v);if(k==='f'){const p=locate(selected);if(p)cameraBus.focus(p);}const index=Number(e.key)-1;if(index>=0&&index<4)selectUnit(index===0?`${side}-commander`:`${side}-${(['scout','vanguard','support'] as const)[index-1]}`,true);}window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);});
  useEffect(()=>{if(!showResult)return;const previous=document.activeElement as HTMLElement|null;const dialog=dialogRef.current;const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled)')||[]);focusable()[0]?.focus();function trap(e:KeyboardEvent){if(e.key!=='Tab')return;const list=focusable(),first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}dialog?.addEventListener('keydown',trap);return()=>{dialog?.removeEventListener('keydown',trap);previous?.focus();};},[showResult]);

  if(missing)return <main className="lobby missing"><div className="hud missing-card"><span className="micro">SIGNAL WAR / BATTLE</span><h1>경기를 열 수 없습니다</h1><p>{missing}</p><button className="primary-button" onClick={()=>router.push('/')}>메인으로<ChevronRight size={16}/></button></div></main>;

  const Icon=focused?ICONS[focused.role]:Radio;
  return <main className={`battle ${side}`}>
    <div className="world"><Arena field={field} frame={frame} selected={selected} side={side} onSelect={target=>selectUnit(target)} resetCamera={resetCamera} fog={fog}/></div>
    <div className="vignette"/>

    <header className="topbar">
      <button className="topbar-exit" onClick={()=>{runner.current++;router.push('/');}} aria-label="메인으로"><ArrowLeft size={15}/><span>MENU</span></button>
      <div className="topbar-field"><strong>{field?.name||'LOADING'}</strong><small>{field?`${BIOMES[field.biome].ko} · SEED ${field.seed}`:'—'}</small></div>
      <div className="topbar-score" aria-label="전투 점수">
        <span className={`team cyan ${side==='cyan'?'you':''}`}>{SIDE_NAMES.cyan}{side==='cyan'&&<em>YOU</em>}</span><b>{String(scores.cyan).padStart(2,'0')}</b>
        <span className="beacon-dots">{BEACONS.map((n,i)=><span className={owners[n]||''} key={n} title={`${n.toUpperCase()} · ${owners[n]?SIDE_NAMES[owners[n] as Side]:'중립'}`}>{String.fromCharCode(65+i)}</span>)}</span>
        <b>{String(scores.amber).padStart(2,'0')}</b><span className={`team amber ${side==='amber'?'you':''}`}>{side==='amber'&&<em>YOU</em>}{SIDE_NAMES.amber}</span>
      </div>
      <div className="topbar-round"><small>ROUND</small><b>{String(round).padStart(2,'0')}</b><small>/ {battle?.max_rounds||30}</small></div>
      <span className={`mode-badge ${battle?.mode==='live'?'live':''}`}><i/>{battle?.mode==='live'?'LIVE AGENTS':'RULES TEST · AI OFF'}</span>
    </header>

    <aside className="comms"><button className="comms-toggle" onClick={()=>setShowFeed(!showFeed)} aria-expanded={showFeed}><Radio size={12}/><span>FIELD COMMS</span><ChevronDown size={12} className={showFeed?'':'rotated'}/></button>{showFeed&&<div className="feed">{events.length?events.map((e,i)=><div key={`${round}-${i}`} className={`feed-item ${e.side}`}><span className="feed-time">{String(e.round).padStart(2,'0')}</span><p>{e.unit_id&&!e.unit_id.endsWith('commander')?`${ROLES[e.unit_id.split('-')[1] as Role]?.name||''} · `:''}{e.message}</p></div>):<div className="feed-item"><span className="feed-time">00</span><p>필드 연결 완료. 분대가 명령을 기다립니다.</p></div>}</div>}</aside>

    {error&&<div className="error-toast" role="alert"><span>{error}</span><button aria-label="오류 닫기" onClick={()=>setError('')}><X size={16}/></button></div>}
    {isReplay&&<div className="replay-badge"><Layers size={13}/>REPLAY · ROUND {round}<button onClick={()=>setFrameIndex(null)}>현재 턴으로 복귀</button></div>}
    {isFinished&&!showResult&&<button className="result-peek hud" onClick={()=>setShowResult(true)}><Flag size={14}/>전투 종료 · {battle.winner==='draw'?'DRAW':`${SIDE_NAMES[battle.winner as Side]} VICTORY`}<ChevronRight size={14}/></button>}

    <div className="transport-bar">
      <button className="play-button" disabled={(!running&&busy)||!battle||isFinished||isReplay||draftDirty} onClick={()=>void play()} aria-label={running?'일시 정지':'전투 시작'}>{busy&&!running?<LoaderCircle size={15} className="spin"/>:running?<Pause size={15}/>:<Play size={15}/>}<span>{running?'PAUSE':'EXECUTE'}</span></button>
      <button className="step-button" disabled={busy||!battle||isFinished||isReplay||draftDirty} title="다음 턴 · N" onClick={()=>void nextRound()}><SkipForward size={15}/><span>1 TURN</span></button>
      <div className="turn-track"><div><span>{isFinished?'COMPLETED':busy?'PROCESSING':draftDirty?`${dirtyTargets.length} UNSENT ORDER(S)`:'SIMULATION ACTIVE'}</span><small>REPLAY {String(frameIndex??Math.max(0,(battle?.frames.length||1)-1)).padStart(2,'0')}</small></div><input aria-label="전투 리플레이" type="range" min="0" max={Math.max(0,(battle?.frames.length||1)-1)} value={frameIndex??Math.max(0,(battle?.frames.length||1)-1)} disabled={busy||!battle||battle.frames.length<2} onChange={e=>setFrameIndex(Number(e.target.value))}/></div>
    </div>

    <section className="console" aria-label="지휘 콘솔">
      <div className="console-map">
        <div className="console-label"><span>SECTOR</span><small>{field?`${field.size}u`:''}</small></div>
        {field&&<Minimap field={field} units={units} owners={owners} selected={selected} side={side} fog={fog} round={round} onSelect={selectUnit}/>}
        <div className="map-tools">
          <button className="square-button" aria-label="전체 맵 보기" title="전체 맵 · R" onClick={()=>setResetCamera(v=>v+1)}><Focus size={16}/></button>
          <button className="square-button" aria-label="선택 대상으로 이동" title="포커스 · F" onClick={()=>{const p=locate(selected);if(p)cameraBus.focus(p);}}><LocateFixed size={16}/></button>
          <button className={`square-button ${fog?'toggled':''}`} aria-pressed={fog} aria-label="전장의 안개" title={`전장의 안개 · V`} onClick={()=>setFog(v=>!v)}>{fog?<EyeOff size={16}/>:<Eye size={16}/>}</button>
          <button className="square-button" aria-label="전체 화면" title="전체 화면" onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void document.documentElement.requestFullscreen().catch(()=>setError('브라우저에서 전체 화면을 지원하지 않습니다.'));}}><Maximize size={16}/></button>
        </div>
      </div>

      <div className="console-unit">
        <div className="unit-detail">
          <div className={`unit-portrait ${focused?.side||side}`}><Portrait side={focused?.side||side} role={focused?.role} commander={isCommander}/></div>
          <div className="unit-main">
            <span className="unit-kicker">{isCommander?`${SIDE_NAMES[selected.split('-')[0] as Side]} COMMANDER`:focused?`${SIDE_NAMES[focused.side]} · ${ROLES[focused.role].short}`:'AGENT'}</span>
            <h2>{targetName}{!isCommander&&focused&&<Icon size={14}/>}<i className={canCommand?'online':''}/></h2>
            {!isCommander&&focused?<>
              <div className="hp-cells" aria-label={`에너지 ${focused.hp}/5`}>{[0,1,2,3,4].map(k=><i key={k} className={k<focused.hp?'on':''}/>)}<span>{focused.hp===0?'OFFLINE':`${focused.hp}/5`}</span></div>
              <div className="status-chips">{focused.shield>0&&<span>SHIELD</span>}{(focused.scan_until||0)>round&&<span>SCAN +{RULES.scanBonus}</span>}{focused.hp===0&&<span className="off">DISABLED</span>}</div>
            </>:<p className="unit-sub">임무 분해 → 하위 에이전트 지휘</p>}
          </div>
          {!isCommander&&focused?<dl className="unit-stats"><div><dt>시야</dt><dd>{sensorRange(focused,round)}</dd></div><div><dt>사거리</dt><dd>{RULES.pulse[focused.role]}</dd></div><div><dt>이동</dt><dd>{RULES.speed}</dd></div><div><dt>위치</dt><dd>{Math.round(focused.x)},{Math.round(focused.y)}</dd></div></dl>
          :<div className="unit-orders"><span>TASK DECOMPOSITION</span><p title={commandSignal||''}>{commandSignal||'첫 턴에 사령관이 전략을 역할별 임무로 나눕니다.'}</p></div>}
          {!isCommander&&<div className="unit-orders"><span>ASSIGNMENT</span><p>{unitTask?.instruction||'사용자 전략과 사령관의 임무를 기다립니다.'}</p><code>{lastTool?.message||'standby()'}</code></div>}
        </div>
        <div className="squad-strip">
          <button className={`squad-card ${selected===`${side}-commander`?'selected':''}`} onClick={()=>selectUnit(`${side}-commander`,true)} aria-pressed={selected===`${side}-commander`}><span className="key">1</span><Portrait side={side} commander/><span className="squad-info"><small>COMMANDER</small><strong>SPARK</strong><span className="bar commander"><i/></span></span></button>
          {own.map((u,i)=>{const task=tasks.find(t=>t.unit_id===u.id);return <button key={u.id} className={`squad-card ${selected===u.id?'selected':''} ${u.hp===0?'down':''}`} aria-pressed={selected===u.id} aria-label={`${ROLES[u.role].name} ${ROLES[u.role].ko} 선택`} onClick={()=>selectUnit(u.id,true)} title={task?.instruction}><span className="key">{i+2}</span><Portrait side={side} role={u.role}/><span className="squad-info"><small>{ROLES[u.role].short}</small><strong>{ROLES[u.role].name}</strong><span className="bar"><i style={{width:`${u.hp*20}%`}}/></span></span></button>;})}
        </div>
      </div>

      <div className="console-command">
        <div className="console-label"><span>{canCommand?'COMMAND CARD':'OBSERVATION'}</span><small>{SIDE_NAMES[side]}</small></div>
        {canCommand?<>
          {isCommander?<div className="task-grid">{(['scout','vanguard','support'] as Role[]).map(role=>{const a=tasks.find(t=>t.unit_id===`${side}-${role}`);return <button key={role} onClick={()=>selectUnit(`${side}-${role}`,true)}><span>{ROLES[role].name}</span><p>{a?.instruction||'첫 턴에 임무 하달'}</p></button>;})}</div>
          :<div className="tool-card" aria-label="에이전트 도구 · 에이전트가 직접 선택">{LIVE_TOOLS.map(t=>{const usable=!t.roles||(focused&&t.roles.includes(focused.role));const used=lastTool?.message.startsWith(`${t.id}(`);return <span key={t.id} className={`${usable?'':'locked'} ${used?'used':''}`} title={`${t.detail}${usable?'':' · 이 역할은 사용 불가'}`}><code>{t.name}</code></span>;})}</div>}
          <div className="order-box"><textarea aria-label={`${targetName} 전략 입력`} value={prompt} maxLength={1200} disabled={busy||isFinished||isReplay} placeholder={isCommander?'분대 전체 임무와 거점 우선순위를 지시하세요.':'예: 알파 거점으로 이동해. 시야를 스캔하고 상황을 보고해.'} onChange={e=>updatePrompt(e.target.value)} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();void saveStrategy();}}}/><button aria-label="전략 전달" title="전략 전달 · ⌘ Enter" disabled={busy||isFinished||isReplay||!prompt.trim()} onClick={()=>void saveStrategy()}>{saved?<Check size={16}/>:<Send size={16}/>}</button></div>
          <small className="order-state">{saved?'전달됨':dirtyTargets.includes(selected)?'작성 중 · 전달해야 턴이 진행됩니다':isCommander?'분대 전체에 내릴 임무':'이 에이전트에게 내릴 직접 지시'}</small>
        </>:<p className="enemy-note">{focused?`${SIDE_NAMES[focused.side]}의 ${ROLES[focused.role].name}입니다. 상대 분대에는 지시할 수 없습니다.`:'상대 사령관은 프리셋 전략으로 움직입니다.'}</p>}
      </div>
    </section>

    {showResult&&battle&&<div className="modal-backdrop" onClick={()=>setShowResult(false)}><section className="game-modal result-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label="MISSION COMPLETE" onClick={e=>e.stopPropagation()}><header><div><span className="micro">SIGNAL WAR / RESULT</span><h2>MISSION COMPLETE</h2></div><button className="square-button" aria-label="창 닫기" onClick={()=>setShowResult(false)}><X size={20}/></button></header>
      <div className="result-banner"><span>{battle.winner==='draw'?'SIGNAL BALANCED':battle.winner===side?`${SIDE_NAMES[side]} VICTORY`:`${SIDE_NAMES[battle.winner as Side]} VICTORY · DEFEAT`}</span><strong>{battle.scores.cyan}<em>:</em>{battle.scores.amber}</strong><p>{battle.name} · {battle.round} ROUNDS · SEED {battle.field.seed}</p></div>
      <div className="result-art">{battle.image_path?<img src={`/api${battle.image_path}`} alt="Muse Image 전투 결과 아트"/>:<><Sparkles size={32}/><p>이번 전투를 한 장의 이미지로 기록하세요.</p><button className="primary-button" disabled={busy||!config?.image.ready} onClick={()=>void makeImage()}>{busy?<LoaderCircle className="spin" size={16}/>:<ImagePlus size={16}/>}Muse Image 결과 생성</button><small>생성할 때 모델 크레딧이 사용됩니다.</small></>}</div>
      <div className="result-actions"><button className="secondary-button" onClick={()=>{setFrameIndex(0);setShowResult(false);}}>리플레이 보기</button><button className="primary-button" onClick={()=>router.push('/')}><Shuffle size={15}/>메인으로</button></div>
    </section></div>}
  </main>;
}
