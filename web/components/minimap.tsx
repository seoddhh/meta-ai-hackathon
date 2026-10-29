'use client';
import { useSyncExternalStore } from 'react';
import { SIDE_NAMES } from '@/lib/api';
import { cameraBus } from '@/lib/camera';
import { BEACONS, ROLES, Side, Terrain, Unit, canSee, sensorRange } from '@/lib/types';

/** Whole-field overview: terrain shapes, routes, camera footprint. Click ground to move the camera, click a unit to select it. */
export default function Minimap({field,units,owners,selected,side,fog,round,onSelect}:{field:Terrain;units:Unit[];owners:Record<string,string|null>;selected:string;side:Side;fog:boolean;round:number;onSelect:(id:string,focus?:boolean)=>void}){
  const view=useSyncExternalStore(cameraBus.subscribe,cameraBus.getView,cameraBus.getView);
  const own=units.filter(u=>u.side===side&&u.hp>0);
  const shown=units.filter(u=>u.hp>0&&(!fog||u.side===side||own.some(a=>canSee(field,a,u,round))));
  const color={forest:'#304d38',rock:'#8e9480',water:'#75afac'};const team={cyan:'#92ffe1',amber:'#ffc178'};
  function jump(e:React.MouseEvent<SVGSVGElement>){const svg=e.currentTarget,m=svg.getScreenCTM();if(!m)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());cameraBus.focus([Math.max(0,Math.min(field.size,p.x)),Math.max(0,Math.min(field.size,p.y))]);}
  const unit=field.size/100;
  return <svg className="minimap" viewBox={`0 0 ${field.size} ${field.size}`} role="img" aria-label="전장 미니맵 · 클릭해 카메라 이동" onClick={jump}>
    <rect width={field.size} height={field.size} fill="#536a49"/>
    <polyline points={field.river.points.map(p=>p.join(',')).join(' ')} fill="none" stroke={color.water} strokeWidth={field.river.width} strokeLinejoin="round" strokeLinecap="round"/>
    {field.obstacles.map((o,i)=><circle key={i} cx={o.x} cy={o.y} r={o.r} fill={color[o.kind]}/>)}
    {field.bridges.map((b,i)=><rect key={i} x={b.x-b.length/2} y={b.y-b.width/2} width={b.length} height={b.width} fill="#c7b58b" transform={`rotate(${b.angle*180/Math.PI} ${b.x} ${b.y})`}/>)}
    {fog&&own.map(u=><circle key={`fog-${u.id}`} cx={u.x} cy={u.y} r={sensorRange(u,round)} fill="#e9f3cf" opacity=".1"/>)}
    {(['cyan','amber'] as Side[]).map(s=>{const [x,y]=field.bases[s];return <rect key={s} x={x-140} y={y-140} width="280" height="280" fill={team[s]} stroke="#172c23" strokeWidth={unit*.6}/>;})}
    {BEACONS.filter(n=>field.beacons[n]).map(name=>{const [x,y]=field.beacons[name];return <rect key={name} x={x-110} y={y-110} width="220" height="220" transform={`rotate(45 ${x} ${y})`} fill={owners[name]==='cyan'?'#7df3d8':owners[name]==='amber'?'#ffbd76':'#fff7ce'} stroke="#283e32" strokeWidth={unit*.6}/>;})}
    {shown.filter(u=>u.path&&u.path.length>1).map(u=><polyline key={`path-${u.id}`} points={u.path!.map(p=>p.join(',')).join(' ')} fill="none" stroke={team[u.side]} strokeWidth={unit*(selected===u.id?.9:.5)} opacity=".85"/>)}
    {view.footprint.length===4&&<polygon points={view.footprint.map(p=>p.join(',')).join(' ')} fill="#f4f8e61a" stroke="#f4f8e6" strokeWidth={unit*.55} pointerEvents="none"/>}
    {shown.map(u=><g key={u.id} onClick={e=>{e.stopPropagation();onSelect(u.id,true);}} role="button" tabIndex={0} aria-label={`미니맵 ${SIDE_NAMES[u.side]} ${ROLES[u.role].name} 선택`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(u.id,true);}}}><circle cx={u.x} cy={u.y} r={selected===u.id?unit*2.4:unit*1.6} fill={team[u.side]} stroke="#172c23" strokeWidth={unit*.5}/><circle cx={u.x} cy={u.y} r={unit*3.4} fill="transparent"/></g>)}
  </svg>;
}
