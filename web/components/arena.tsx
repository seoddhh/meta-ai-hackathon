'use client';
import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Frame, ROLES, Side, Terrain, Unit, previewUnits } from '@/lib/types';

const TEAM={cyan:'#77f5d5',amber:'#ffba68'};
const PALETTES={woodland:{grass:['#527547','#64854e','#769456','#435f3e'],tree:['#35583e','#4d7545','#638d4e'],rock:'#959a89',water:'#75aeb0'},highland:{grass:['#747a58','#8a8c66','#676e53','#979b75'],tree:['#465e49','#59735a','#718665'],rock:'#9a9c91',water:'#82b3b5'},wetland:{grass:['#496a55','#5b7d60','#72916b','#3c5d4c'],tree:['#315746','#467054','#5e8261'],rock:'#89998d',water:'#80b8b0'}};
const hash=(x:number,y:number,seed:number)=>{const n=Math.sin(x*127.1+y*311.7+seed*.017)*43758.5453;return n-Math.floor(n);};
function cellHeight(field:Terrain,x:number,y:number){return field.cells[Math.max(0,Math.min(field.size-1,y))*field.size+Math.max(0,Math.min(field.size-1,x))]?.height||0;}
function position(field:Terrain,x:number,y:number):[number,number,number]{const mid=(field.size-1)/2;return [x-mid,cellHeight(field,x,y),y-mid];}

class SceneBoundary extends Component<{children:React.ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return{failed:true};}render(){return this.state.failed?<div className="scene-fallback">3D 렌더링을 시작할 수 없습니다. WebGL을 지원하는 브라우저를 사용하세요. 유닛 선택과 턴 진행은 HUD에서 사용할 수 있습니다.</div>:this.props.children;}}

function WorldLabel({text,color,selected=false,hp,beacon=false}:{text:string;color:string;selected?:boolean;hp?:number;beacon?:boolean}){
  const texture=useMemo(()=>{const canvas=document.createElement('canvas');canvas.width=256;canvas.height=72;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#1b3026ee';ctx.fillRect(4,4,248,49);ctx.strokeStyle=selected?color:'#94b08099';ctx.lineWidth=selected?3:2;ctx.strokeRect(4,4,248,49);ctx.font='bold 24px monospace';ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(text,128,36);if(hp!==undefined){ctx.fillStyle='#1b3026';ctx.fillRect(40,62,176,5);ctx.fillStyle=color;ctx.fillRect(40,62,176*hp/5,5);}const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;return t;},[text,color,selected,hp]);
  useEffect(()=>()=>texture.dispose(),[texture]);
  return <sprite scale={beacon?[1.65,.46,1]:[1.35,.38,1]}><spriteMaterial map={texture} transparent depthWrite={false}/></sprite>;
}

function Ground({field}:{field:Terrain}){
  const palette=PALETTES[field.biome];
  const geometry=useMemo(()=>{
    const vertices:number[]=[],colors:number[]=[];const mid=(field.size-1)/2;
    const height=(x:number,y:number)=>{if(x>=0&&y>=0&&x<=field.size&&y<=field.size)return field.heights[y][x];const edge=field.heights[Math.max(0,Math.min(field.size,y))][Math.max(0,Math.min(field.size,x))];return edge+Math.min(5,Math.max(-x,x-field.size,-y,y-field.size)*.45)+hash(x,y,field.seed)*1.5;};
    for(let y=-10;y<field.size+10;y++)for(let x=-10;x<field.size+10;x++){
      const cell=field.cells[y*field.size+x];const inside=x>=0&&y>=0&&x<field.size&&y<field.size;
      const v=[[x-.5-mid,height(x,y),y-.5-mid],[x+.5-mid,height(x+1,y),y-.5-mid],[x-.5-mid,height(x,y+1),y+.5-mid],[x+.5-mid,height(x+1,y+1),y+.5-mid]];
      const indices=hash(x,y,field.seed)>.5?[[0,2,1],[1,2,3]]:[[0,2,3],[0,3,1]];
      for(let t=0;t<2;t++){
        const c=new THREE.Color(inside&&cell?.kind==='path'?'#8b8764':inside&&cell?.kind==='rock'?palette.rock:palette.grass[Math.floor(hash(x,y,field.seed+8)*4)]);
        c.multiplyScalar(.91+hash(x*2+t,y,field.seed+20)*.18);
        for(const index of indices[t]){vertices.push(...v[index]);colors.push(c.r,c.g,c.b);}
      }
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();return geo;
  },[field,palette]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <><mesh geometry={geometry} receiveShadow><meshStandardMaterial vertexColors roughness={1} flatShading/></mesh><mesh rotation={[-Math.PI/2,0,0]} position={[0,-.17,0]} receiveShadow><planeGeometry args={[field.size+18,field.size+18]}/><meshStandardMaterial color={palette.water} roughness={.33} metalness={.1}/></mesh></>;
}

type Instance={p:[number,number,number];s:[number,number,number];r:number;color:string};
function Instances({items,kind}:{items:Instance[];kind:'cone'|'trunk'|'rock'}){
  const ref=useRef<THREE.InstancedMesh>(null);
  useEffect(()=>{if(!ref.current)return;const obj=new THREE.Object3D();items.forEach((a,i)=>{obj.position.set(...a.p);obj.rotation.set(0,a.r,kind==='rock'?a.r*.2:0);obj.scale.set(...a.s);obj.updateMatrix();ref.current!.setMatrixAt(i,obj.matrix);ref.current!.setColorAt(i,new THREE.Color(a.color));});ref.current.instanceMatrix.needsUpdate=true;if(ref.current.instanceColor)ref.current.instanceColor.needsUpdate=true;},[items,kind]);
  if(!items.length)return null;
  return <instancedMesh ref={ref} args={[undefined,undefined,items.length]} castShadow receiveShadow frustumCulled={false}>{kind==='cone'?<coneGeometry args={[1,1,6]}/>:kind==='trunk'?<cylinderGeometry args={[.08,.13,1,5]}/>:<dodecahedronGeometry args={[1,0]}/>}<meshStandardMaterial roughness={1} flatShading/></instancedMesh>;
}
function Vegetation({field}:{field:Terrain}){
  const data=useMemo(()=>{
    const cones:Instance[]=[],trunks:Instance[]=[],rocks:Instance[]=[];const palette=PALETTES[field.biome];const mid=(field.size-1)/2;
    const tree=(x:number,y:number,h:number,v:number)=>{const s=.75+v*.65;trunks.push({p:[x,h+s*.4,y],s:[s,s*.8,s],r:v*6,color:'#716549'});for(let i=0;i<3;i++)cones.push({p:[x,h+s*(.65+i*.48),y],s:[s*(.62-i*.14),s*.95,s*(.62-i*.14)],r:v*6+i*.3,color:palette.tree[i]});};
    for(const c of field.cells){const p=position(field,c.x,c.y);if(c.kind==='forest'){tree(p[0]+(c.variant-.5)*.3,p[2],c.height,c.variant);if(c.variant>.5)tree(p[0]-.35,p[2]+.32,c.height,c.variant*.7);}if(c.kind==='rock')rocks.push({p:[p[0],p[1]+.3,p[2]],s:[.42+c.variant,.4+c.variant*1.3,.4+c.variant*.6],r:c.variant*6,color:palette.rock});if(c.kind==='grass'&&c.variant>.7)rocks.push({p:[p[0]+.3,p[1]+.08,p[2]+.3],s:[.12,.1,.15],r:c.variant*6,color:palette.rock});}
    for(let y=-7;y<field.size+7;y++)for(let x=-7;x<field.size+7;x++){if(x>=0&&x<field.size&&y>=0&&y<field.size)continue;const v=hash(x,y,field.seed);const edge=cellHeight(field,x,y);const h=edge+Math.min(5,Math.max(-x,x-field.size+1,-y,y-field.size+1)*.45)+v*.6;if(v>.46)tree(x-mid,y-mid,h,v);else if(v<.18)rocks.push({p:[x-mid,h,y-mid],s:[1+v,1.5+v*2,1.2],r:v*12,color:palette.rock});}
    return{cones,trunks,rocks};
  },[field]);
  return <><Instances items={data.trunks} kind="trunk"/><Instances items={data.cones} kind="cone"/><Instances items={data.rocks} kind="rock"/></>;
}
function Bridges({field}:{field:Terrain}){return <>{field.cells.filter(c=>c.kind==='bridge').map(c=><group key={`${c.x}-${c.y}`} position={position(field,c.x,c.y)}><mesh receiveShadow castShadow position={[0,.02,0]}><boxGeometry args={[1.04,.16,.86]}/><meshStandardMaterial color="#a2946e"/></mesh>{[-.36,.36].map(z=><mesh key={z} position={[0,.18,z]} castShadow><boxGeometry args={[1.04,.08,.06]}/><meshStandardMaterial color="#5e624c"/></mesh>)}{[-.3,0,.3].map(x=><mesh key={x} position={[x,.108,0]}><boxGeometry args={[.025,.012,.83]}/><meshStandardMaterial color="#605b46"/></mesh>)}</group>)}</>;}

function Robot({unit,field,selected,onSelect,reduced,commander=false}:{unit:Unit;field:Terrain;selected:boolean;onSelect:()=>void;reduced:boolean;commander?:boolean}){
  const ref=useRef<THREE.Group>(null);const target=position(field,unit.x,unit.y);const color=TEAM[unit.side];const armor=unit.side==='cyan'?'#d1dfc4':'#e2c7a0';
  useFrame((_,delta)=>{if(ref.current){const p=new THREE.Vector3(target[0],target[1]+.13,target[2]);if(reduced)ref.current.position.copy(p);else ref.current.position.lerp(p,1-Math.exp(-delta*6));}});
  return <group ref={ref} position={[target[0],target[1]+.13,target[2]]} onClick={e=>{e.stopPropagation();onSelect();}}>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.025,0]}><ringGeometry args={[selected?.55:.36,selected?.61:.4,48]}/><meshBasicMaterial color={color} transparent opacity={selected?1:.65} depthWrite={false}/></mesh>
    {selected&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.02,0]}><circleGeometry args={[.55,40]}/><meshBasicMaterial color={color} transparent opacity={.16} depthWrite={false}/></mesh>}
    <group rotation={[0,unit.side==='cyan'?Math.PI/2:-Math.PI/2,0]} scale={commander?1.15:1}>
      {[-.15,.15].map(x=><group key={x} position={[x,.16,0]}><mesh castShadow><boxGeometry args={[.18,.3,.21]}/><meshStandardMaterial color="#344337"/></mesh><mesh castShadow position={[0,-.08,.06]}><boxGeometry args={[.21,.12,.32]}/><meshStandardMaterial color="#26352c"/></mesh></group>)}
      <mesh position={[0,.48,0]} castShadow>{unit.role==='scout'?<cylinderGeometry args={[.22,.19,.37,5]}/>:<boxGeometry args={[unit.role==='vanguard'?.49:.4,.36,.3]}/>}<meshStandardMaterial color={armor} roughness={.85} flatShading/></mesh>
      {[-.31,.31].map(x=><mesh key={x} position={[x,.45,.025]} rotation={[.12,0,x*.6]} castShadow><boxGeometry args={[.15,.3,.2]}/><meshStandardMaterial color={armor}/></mesh>)}
      <mesh position={[0,.81,0]} castShadow><dodecahedronGeometry args={[.26,0]}/><meshStandardMaterial color={armor} flatShading/></mesh>
      <mesh position={[0,.81,.222]}><boxGeometry args={[.33,.09,.065]}/><meshStandardMaterial color="#1d3935"/></mesh>
      <mesh position={[0,.815,.26]}><boxGeometry args={[.22,.025,.015]}/><meshBasicMaterial color={color}/></mesh>
      <mesh position={[0,.49,.16]}><boxGeometry args={[.12,.12,.03]}/><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.5}/></mesh>
      {unit.role==='support'&&<><mesh position={[0,.48,-.22]} castShadow><boxGeometry args={[.32,.34,.16]}/><meshStandardMaterial color="#526f53"/></mesh><mesh position={[0,.55,-.31]}><boxGeometry args={[.17,.045,.02]}/><meshBasicMaterial color={color}/></mesh><mesh position={[0,.55,-.32]}><boxGeometry args={[.045,.17,.02]}/><meshBasicMaterial color={color}/></mesh></>}
      {(unit.role==='scout'||commander)&&<mesh position={[.19,1.05,-.08]}><cylinderGeometry args={[.013,.013,.44,4]}/><meshStandardMaterial color="#394937"/></mesh>}
      {commander&&<mesh position={[0,1.28,0]}><octahedronGeometry args={[.14]}/><meshBasicMaterial color={color}/></mesh>}
    </group>
    {unit.shield>0&&<mesh position={[0,.52,0]}><sphereGeometry args={[.68,16,12]}/><meshBasicMaterial color={color} transparent opacity={.1} wireframe/></mesh>}
    <group position={[0,commander?1.65:1.45,0]}><WorldLabel text={commander?'SPARK / CMD':ROLES[unit.role].name} color={color} selected={selected} hp={commander?undefined:unit.hp}/></group>
  </group>;
}

function World({field,frame,selected,side,onSelect,reduced,resetCamera}:{field:Terrain;frame:Frame|null;selected:string;side:Side;onSelect:(id:string)=>void;reduced:boolean;resetCamera:number}){
  const {camera,size}=useThree();const controls=useRef<React.ComponentRef<typeof OrbitControls>>(null);
  useEffect(()=>{if(camera instanceof THREE.OrthographicCamera){camera.position.set(19,25,22);camera.zoom=Math.max(10,Math.min(size.width/29,size.height/23));camera.updateProjectionMatrix();controls.current?.target.set(0,0,0);controls.current?.update();}},[camera,size,field.seed,resetCamera]);
  const units=frame?.units||previewUnits(field);const selectedUnit=units.find(u=>u.id===selected);
  const visibleCells=selectedUnit?field.cells.filter(c=>Math.abs(c.x-selectedUnit.x)+Math.abs(c.y-selectedUnit.y)<= (selectedUnit.role==='scout'?5:3)):[];
  return <>
    <color attach="background" args={['#b9c7ad']}/><fog attach="fog" args={['#b9c7ad',43,83]}/>
    <ambientLight intensity={.65}/><hemisphereLight args={['#fff2d6','#4f6550',1.65]}/>
    <directionalLight position={[-12,24,-9]} intensity={3.4} color="#fff1cb" castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-27} shadow-camera-right={27} shadow-camera-top={27} shadow-camera-bottom={-27} shadow-bias={-.0003} shadow-normalBias={.07}/>
    <Ground field={field}/><Vegetation field={field}/><Bridges field={field}/>
    {visibleCells.filter(c=>!c.blocked).map(c=><mesh key={`range-${c.x}-${c.y}`} position={[...position(field,c.x,c.y).map((n,i)=>i===1?n+.035:n)] as [number,number,number]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[.9,.9]}/><meshBasicMaterial color={TEAM[side]} transparent opacity={.07} depthWrite={false}/></mesh>)}
    {Object.entries(field.beacons).map(([name,[x,y]],i)=>{const owner=frame?.owners[name];const color=owner==='cyan'?TEAM.cyan:owner==='amber'?TEAM.amber:'#f5e8b0';const p=position(field,x,y);return <group key={name} position={[p[0],p[1]+.14,p[2]]}>
      <mesh castShadow><cylinderGeometry args={[.42,.5,.19,6]}/><meshStandardMaterial color="#495849"/></mesh><mesh position={[0,.5,0]} castShadow><cylinderGeometry args={[.065,.1,.8,6]}/><meshStandardMaterial color="#ddd7b9"/></mesh><mesh position={[0,1.08,0]}><octahedronGeometry args={[.23,0]}/><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.6}/></mesh>
      <mesh position={[0,.015,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.68,.73,48]}/><meshBasicMaterial color={color} transparent opacity={.8}/></mesh>
      <group position={[0,1.75,0]}><WorldLabel text={`${String.fromCharCode(65+i)} / ${name.toUpperCase()}`} color={color} beacon/></group>
    </group>;})}
    {units.filter(u=>u.hp>0).map(u=><Robot key={u.id} unit={u} field={field} selected={selected===u.id} onSelect={()=>onSelect(u.id)} reduced={reduced}/>)}
    {(['cyan','amber'] as Side[]).map(s=>{const x=s==='cyan'?1:field.size-2,y=10;return <Robot key={`${s}-commander`} unit={{id:`${s}-commander`,side:s,role:'vanguard',x,y,hp:5,shield:0}} field={field} selected={selected===`${s}-commander`} onSelect={()=>onSelect(`${s}-commander`)} reduced={reduced} commander/>;})}
    {frame?.events.filter(e=>e.kind==='tool'&&e.message.startsWith('pulse(')).map((e,i)=>{const a=units.find(u=>u.id===e.unit_id),b=units.find(u=>u.id===e.message.slice(6,-1));if(!a||!b)return null;const pa=position(field,a.x,a.y),pb=position(field,b.x,b.y);return <Line key={`${frame.round}-${i}`} points={[[pa[0],pa[1]+.65,pa[2]],[pb[0],pb[1]+.65,pb[2]]]} color={TEAM[a.side]} lineWidth={2} transparent opacity={.7}/>;})}
    <OrbitControls ref={controls} makeDefault enablePan screenSpacePanning minZoom={10} maxZoom={100} minPolarAngle={.35} maxPolarAngle={1.25} maxDistance={60} target={[0,0,0]} mouseButtons={{LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN}}/>
  </>;
}

export default function Arena(props:{field:Terrain|null;frame:Frame|null;selected:string;side:Side;onSelect:(id:string)=>void;resetCamera:number}){
  const [reduced,setReduced]=useState(false);
  useEffect(()=>{const m=window.matchMedia('(prefers-reduced-motion: reduce)');setReduced(m.matches);const change=()=>setReduced(m.matches);m.addEventListener('change',change);return()=>m.removeEventListener('change',change);},[]);
  if(!props.field)return <div className="scene-fallback"><span className="loading-mark"/>전장 지형을 생성하는 중…</div>;
  return <SceneBoundary><Canvas shadows orthographic camera={{position:[19,25,22],zoom:34,near:.1,far:150}} dpr={[1,1.5]} gl={{antialias:true,toneMapping:THREE.ACESFilmicToneMapping}} fallback={<div className="scene-fallback">WebGL을 지원하는 브라우저에서 3D 전장을 확인하세요.</div>}><Suspense fallback={null}><World {...props} field={props.field} reduced={reduced}/></Suspense></Canvas></SceneBoundary>;
}
