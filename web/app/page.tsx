'use client';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Archive, ArrowRight, BookOpen, Check, ChevronRight, Cpu, Flag, Layers, Lock, Map as MapIcon, Settings2, Shuffle, Swords, Trees, Users, Wrench } from 'lucide-react';
import { api, freshSeed, SIDE_NAMES } from '@/lib/api';
import { PERSONALITIES, REGULATIONS, RULESETS, TOOLS } from '@/lib/catalog';
import { BattleSummary, Biome, BIOMES, Config, Side, Terrain } from '@/lib/types';

const Arena=dynamic(()=>import('@/components/arena'),{ssr:false,loading:()=> <div className="scene-fallback">전장 렌더러 준비 중…</div>});
type Menu='setup'|'archive'|'settings';
type SetupTab='rules'|'tools'|'personality'|'field';
const MOCK=<span className="mock-tag" title="규칙 설계 전 목업입니다. 선택해도 경기에 반영되지 않습니다.">목업, 설계 예정</span>;
const STEPS=<ol className="steps" aria-label="진행 단계"><li aria-current="step"><b>1</b>경기 설정</li><li><b>2</b>에이전트 선택</li></ol>;

export default function Main(){
  const router=useRouter();
  const [menu,setMenu]=useState<Menu>('setup'),[tab,setTab]=useState<SetupTab>('rules');
  const [config,setConfig]=useState<Config|null>(null),[gallery,setGallery]=useState<BattleSummary[]>([]),[field,setField]=useState<Terrain|null>(null);
  const [seed,setSeed]=useState(''),[biome,setBiome]=useState<Biome>('woodland'),[mode,setMode]=useState<'rehearsal'|'live'>('rehearsal');
  const [ruleset,setRuleset]=useState('standard'),[regulations,setRegulations]=useState(()=>REGULATIONS.filter(r=>r.live).map(r=>r.id));
  const [toolPool,setToolPool]=useState(()=>TOOLS.filter(t=>t.live).map(t=>t.id)),[personalities,setPersonalities]=useState(()=>PERSONALITIES.map(p=>p.id)),[interplay,setInterplay]=useState(false);
  const [error,setError]=useState(''),[loading,setLoading]=useState(false);

  useEffect(()=>{setSeed(String(freshSeed()));Promise.all([api<Config>('config'),api<BattleSummary[]>('battles')]).then(([c,g])=>{setConfig(c);setGallery(g);}).catch(e=>setError(e.message));},[]);
  useEffect(()=>{const value=Number(seed);if(!seed||!Number.isInteger(value)||value<0||value>2147483647)return;const timer=setTimeout(()=>{setLoading(true);api<Terrain>('terrain','POST',{seed:value,biome}).then(f=>{setField(f);setError('');}).catch(e=>setError(e.message)).finally(()=>setLoading(false));},350);return()=>clearTimeout(timer);},[seed,biome]);

  const seedValid=seed!==''&&Number.isInteger(Number(seed))&&Number(seed)>=0&&Number(seed)<=2147483647;
  const toggle=(list:string[],set:(v:string[])=>void,id:string)=>set(list.includes(id)?list.filter(x=>x!==id):[...list,id]);
  function proceed(){if(field&&seedValid)router.push(`/draft?seed=${field.seed}&biome=${field.biome}&mode=${mode}`);}

  return <main className="lobby">
    <div className="world lobby-world"><Arena field={field} frame={null} selected="" side="cyan" onSelect={()=>{}} resetCamera={0} fog={false}/></div>
    <div className="lobby-shade"/>
    <aside className="lobby-nav">
      <div className="lobby-brand"><div className="brand-symbol" aria-hidden="true"><Swords size={22}/></div><div><strong className="wordmark">SIGNAL WAR<span>_</span></strong><small>Natural-language agent strategy</small></div></div>
      <p className="lobby-pitch">전략은 말로 내리고, 판단은 에이전트가 합니다.<br/>사령관과 분대가 5000u 전장에서 세 신호 거점을 다툽니다.</p>
      <nav className="lobby-menu" aria-label="메인 메뉴">
        <button className={menu==='setup'?'active':''} onClick={()=>setMenu('setup')}><Swords size={16}/><span>새 경기</span><small>규칙, 도구, 전장</small><ChevronRight size={14}/></button>
        <button className={menu==='archive'?'active':''} onClick={()=>{setMenu('archive');api<BattleSummary[]>('battles').then(setGallery).catch(e=>setError(e.message));}}><Archive size={16}/><span>경기 기록</span><small>기록 <span className="num">{gallery.length}</span>건</small><ChevronRight size={14}/></button>
        <button className={menu==='settings'?'active':''} onClick={()=>setMenu('settings')}><Settings2 size={16}/><span>모델 연결</span><small>{config?.live_ready?'실제 모델 준비됨':'엔진 테스트'}</small><ChevronRight size={14}/></button>
      </nav>
      <dl className="lobby-foot"><div><dt>전장</dt><dd>{field?field.name:'생성 중…'}</dd></div><div><dt>시드</dt><dd className="num">{field?field.seed:'…'}</dd></div><div><dt>대전</dt><dd>1:1, 플레이어 대 프리셋</dd></div><div><dt>버전</dt><dd className="num">v0.4</dd></div></dl>
    </aside>

    <section className="lobby-panel">
      {menu==='setup'&&<>
        <header className="panel-head"><h1>경기 설정</h1>{STEPS}</header>
        <div className="tabs" role="tablist" aria-label="경기 설정 항목">
          {([['rules','규칙·규정',BookOpen],['tools','도구 풀',Wrench],['personality','성격',Users],['field','전장',MapIcon]] as const).map(([id,label,Icon])=><button key={id} role="tab" aria-selected={tab===id} className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon size={14}/>{label}</button>)}
        </div>
        <div className="panel-body">
          {tab==='rules'&&<>
            <h2 className="section-title"><span>규칙 세트</span>{MOCK}</h2>
            <div className="choice-grid three">{RULESETS.map(r=><button key={r.id} className={`choice-card ${ruleset===r.id?'selected':''}`} aria-pressed={ruleset===r.id} onClick={()=>setRuleset(r.id)}>
              <strong>{r.name}{r.live&&<em className="live-tag">현재 엔진</em>}</strong><p>{r.summary}</p><dl>{r.stats.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            </button>)}</div>
            <h2 className="section-title"><span>규정</span><small>잠금 항목은 엔진이 항상 적용합니다</small></h2>
            <ul className="check-list">{REGULATIONS.map(r=><li key={r.id}><button className={regulations.includes(r.id)?'checked':''} disabled={r.locked} aria-pressed={regulations.includes(r.id)} onClick={()=>toggle(regulations,setRegulations,r.id)}>
              <span className="box">{r.locked?<Lock size={11}/>:regulations.includes(r.id)&&<Check size={12}/>}</span><span><strong>{r.label}</strong><small>{r.detail}</small></span>{!r.live&&<em className="plan-tag">예정</em>}
            </button></li>)}</ul>
          </>}
          {tab==='tools'&&<>
            <h2 className="section-title"><span>이번 경기에서 쓸 수 있는 도구</span>{MOCK}</h2>
            <p className="panel-note">에이전트는 지시를 읽고 이 풀 안에서 도구를 스스로 고릅니다. 플레이어가 도구를 직접 누르지 않습니다.</p>
            <div className="tool-grid">{TOOLS.map(t=><button key={t.id} className={`tool-chip ${toolPool.includes(t.id)?'selected':''}`} aria-pressed={toolPool.includes(t.id)} onClick={()=>toggle(toolPool,setToolPool,t.id)}>
              <code>{t.name}()</code><small>{t.detail}</small>{t.roles&&<em>{t.roles.join(', ')} 전용</em>}{!t.live&&<em className="plan-tag">예정</em>}
            </button>)}</div>
          </>}
          {tab==='personality'&&<>
            <h2 className="section-title"><span>허용할 성격 유형</span>{MOCK}</h2>
            <div className="choice-grid two">{PERSONALITIES.map(p=><button key={p.id} className={`choice-card compact ${personalities.includes(p.id)?'selected':''}`} aria-pressed={personalities.includes(p.id)} onClick={()=>toggle(personalities,setPersonalities,p.id)}><strong>{p.name}</strong><p>{p.trait}</p></button>)}</div>
            <h2 className="section-title"><span>에이전트 간 관계</span></h2>
            <ul className="check-list"><li><button className={interplay?'checked':''} aria-pressed={interplay} onClick={()=>setInterplay(!interplay)}><span className="box">{interplay&&<Check size={12}/>}</span><span><strong>성격 상성 적용</strong><small>같은 분대 안에서 성격 조합이 협동·충돌에 영향을 준다.</small></span><em className="plan-tag">예정</em></button></li></ul>
          </>}
          {tab==='field'&&<>
            <h2 className="section-title"><span>바이옴</span><small>배경이 선택한 전장으로 바뀝니다</small></h2>
            <div className="choice-grid three">{(Object.keys(BIOMES) as Biome[]).map(b=><button key={b} className={`choice-card compact ${biome===b?'selected':''}`} aria-pressed={biome===b} onClick={()=>setBiome(b)}><Trees size={20}/><strong>{BIOMES[b].ko}</strong><p>{BIOMES[b].name}</p></button>)}</div>
            <h2 className="section-title"><span>월드 시드</span><small>같은 시드 = 같은 전장</small></h2>
            <div className="seed-row"><input aria-label="월드 시드" type="number" min="0" max="2147483647" value={seed} onChange={e=>setSeed(e.target.value)}/><button className="square-button" aria-label="무작위 시드" onClick={()=>setSeed(String(freshSeed()))}><Shuffle size={17}/></button></div>
            {!seedValid&&<p className="field-error">0부터 2147483647 사이의 정수를 입력하세요.</p>}
            <div className="terrain-rules"><span><Trees size={14}/>숲·바위: 이동·시야 차단</span><span><Layers size={14}/>강: 다리로 횡단</span><span><Flag size={14}/>거점: 양 기지 경로 거리 보정</span></div>
            <h2 className="section-title"><span>실행 모드</span></h2>
            <div className="choice-grid two">
              <button className={`choice-card compact ${mode==='rehearsal'?'selected':''}`} aria-pressed={mode==='rehearsal'} onClick={()=>setMode('rehearsal')}><Cpu size={18}/><strong>엔진 테스트</strong><p>규칙 기반 정책 · AI 미사용</p></button>
              <button className={`choice-card compact ${mode==='live'?'selected':''}`} aria-pressed={mode==='live'} disabled={!config?.live_ready} onClick={()=>setMode('live')}><Cpu size={18}/><strong>실제 모델</strong><p>{config?.live_ready?'Spark + 수행자 모델':'모델 연결 필요'}</p></button>
            </div>
          </>}
        </div>
        <footer className="panel-foot">
          <span className="foot-meta">{field?<><span>{BIOMES[field.biome].ko}</span><span>시드 <b className="num">{field.seed}</b></span><span>{mode==='live'?'실제 모델':'엔진 테스트'}</span></>:'전장 생성 중…'}</span>
          <button className="primary-button" disabled={!field||loading||!seedValid} onClick={proceed}>에이전트 선택<ArrowRight size={16}/></button>
        </footer>
      </>}

      {menu==='archive'&&<>
        <header className="panel-head"><h1>경기 기록</h1></header>
        <div className="panel-body">{gallery.length?<div className="archive-grid">{gallery.map(g=><button key={g.id} type="button" className="archive-card" onClick={()=>router.push(`/battle/${g.id}`)}><div className={`archive-cover ${g.winner||''}`}>{g.image_path?<img src={`/api${g.image_path}`} alt={`${g.name} 전투 결과 이미지`}/>:<><Flag size={28} aria-hidden="true"/><span>{g.status==='finished'?'종료':'진행 중'}</span></>}</div><div className="archive-info"><h3>{g.name}</h3><p>{g.mode==='live'?'실제 모델':'엔진 테스트'}, 라운드 <span className="num">{g.round}</span></p><div><strong className="num">{g.scores.cyan} : {g.scores.amber}</strong><span>{g.winner==='draw'?'무승부':g.winner?`${SIDE_NAMES[g.winner as Side]} 승리`:'이어하기'}<ChevronRight size={14} aria-hidden="true"/></span></div></div></button>)}</div>:<div className="empty-archive"><Archive size={32} aria-hidden="true"/><p>경기를 실행하면 이곳에 기록됩니다.</p></div>}</div>
      </>}

      {menu==='settings'&&<>
        <header className="panel-head"><h1>모델 연결</h1></header>
        <div className="panel-body">
          <p className="panel-note">사령관이 전략을 임무로 나누고, 각 수행자가 자신의 특성과 도구를 판단합니다. 모델 연결 전에도 엔진 테스트로 맵과 규칙을 플레이할 수 있습니다.</p>
          <table className="provider-table"><thead><tr><th scope="col">역할</th><th scope="col">모델</th><th scope="col">상태</th></tr></thead><tbody>{[['사령관',config?.commander],['역할 에이전트',config?.worker],['결과 아트',config?.image]].map(([label,p])=>{const provider=p as {name:string;ready:boolean}|undefined;return <tr key={String(label)}><th scope="row">{String(label)}</th><td>{provider?.name||'연결 확인 중'}</td><td className={provider?.ready?'online':'offline'}>{provider?.ready?'연결됨':'설정 안 됨'}</td></tr>;})}</tbody></table>
          <p className="setup-note">Glimmer는 별도 추론 주소가 필요합니다. Baseten을 사용하려면 WORKER_PROVIDER=baseten과 BASETEN_API_KEY를 서버 .env에 설정하고 백엔드를 재시작하세요.</p>
        </div>
      </>}
      {error&&<div className="error-toast inline" role="alert"><span>{error}</span><button aria-label="오류 닫기" onClick={()=>setError('')}>×</button></div>}
    </section>
  </main>;
}
