'use client';
import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { cameraBus } from '@/lib/camera';
import { BEACONS, Frame, Point, ROLES, RULES, Side, Terrain, Unit, canSee, previewUnits, sensorRange, sightClear } from '@/lib/types';

const TEAM={cyan:'#77f5d5',amber:'#ffba68'};
const SIDE_NAME={cyan:'AEGIS',amber:'EMBER'};
const PALETTES={woodland:{grass:['#527547','#64854e','#769456','#435f3e'],tree:['#35583e','#4d7545','#638d4e'],rock:'#959a89',water:'#75aeb0',bank:'#8f8b65'},highland:{grass:['#747a58','#8a8c66','#676e53','#979b75'],tree:['#465e49','#59735a','#718665'],rock:'#9a9c91',water:'#82b3b5',bank:'#9b9474'},wetland:{grass:['#496a55','#5b7d60','#72916b','#3c5d4c'],tree:['#315746','#467054','#5e8261'],rock:'#89998d',water:'#80b8b0',bank:'#7f8a66'}};
const SCALE=1/50;          // world units → scene units (5000u map = 100 scene units)
const FLOOR=4;             // standing height over bridges and banks, world units
const ROBOT=1.7;
const MOVE_SECONDS=.8;
const CAMERA_OFFSET=new THREE.Vector3(19,25,22).normalize().multiplyScalar(120);
const hash=(x:number,y:number,seed:number)=>{const n=Math.sin(x*127.1+y*311.7+seed*.017)*43758.5453;return n-Math.floor(n);};
const half=(f:Terrain)=>f.size*SCALE/2;
function heightAt(f:Terrain,x:number,y:number){const n=f.heights.length-1,step=f.size/n;const gx=Math.max(0,Math.min(n,x/step)),gy=Math.max(0,Math.min(n,y/step));const ix=Math.min(n-1,Math.floor(gx)),iy=Math.min(n-1,Math.floor(gy)),tx=gx-ix,ty=gy-iy,h=f.heights;return (h[iy][ix]*(1-tx)+h[iy][ix+1]*tx)*(1-ty)+(h[iy+1][ix]*(1-tx)+h[iy+1][ix+1]*tx)*ty;}
function toScene(f:Terrain,x:number,y:number,lift=0):[number,number,number]{return [x*SCALE-half(f),Math.max(heightAt(f,x,y),FLOOR)*SCALE+lift,y*SCALE-half(f)];}
function toWorld(f:Terrain,v:THREE.Vector3):Point{return [(v.x+half(f))/SCALE,(v.z+half(f))/SCALE];}
/** Polyline draped over the terrain, resampled so long segments follow hills. */
function drape(f:Terrain,points:Point[],lift=.2){const out:[number,number,number][]=[];points.forEach((p,i)=>{if(i===0){out.push(toScene(f,p[0],p[1],lift));return;}const a=points[i-1],steps=Math.max(1,Math.ceil(Math.hypot(p[0]-a[0],p[1]-a[1])/60));for(let k=1;k<=steps;k++)out.push(toScene(f,a[0]+(p[0]-a[0])*k/steps,a[1]+(p[1]-a[1])*k/steps,lift));});return out;}
function circle(cx:number,cy:number,r:number,segments=72):Point[]{return Array.from({length:segments+1},(_,i)=>[cx+Math.cos(i/segments*Math.PI*2)*r,cy+Math.sin(i/segments*Math.PI*2)*r]);}

class SceneBoundary extends Component<{children:React.ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return{failed:true};}render(){return this.state.failed?<div className="scene-fallback">3D 렌더링을 시작할 수 없습니다. WebGL을 지원하는 브라우저를 사용하세요. 유닛 선택과 턴 진행은 HUD에서 사용할 수 있습니다.</div>:this.props.children;}}

function WorldLabel({text,color,selected=false,hp,scale=1}:{text:string;color:string;selected?:boolean;hp?:number;scale?:number}){
  const texture=useMemo(()=>{const canvas=document.createElement('canvas');canvas.width=256;canvas.height=72;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#1b3026ee';ctx.fillRect(4,4,248,49);ctx.strokeStyle=selected?color:'#94b08099';ctx.lineWidth=selected?3:2;ctx.strokeRect(4,4,248,49);ctx.font='bold 24px monospace';ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(text,128,36);if(hp!==undefined){ctx.fillStyle='#1b3026';ctx.fillRect(40,62,176,5);ctx.fillStyle=color;ctx.fillRect(40,62,176*hp/5,5);}const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;return t;},[text,color,selected,hp]);
  useEffect(()=>()=>texture.dispose(),[texture]);
  return <sprite scale={[2.3*scale,.65*scale,1]}><spriteMaterial map={texture} transparent depthWrite={false}/></sprite>;
}

/** Heightmap ground plus a skirt of rising hills beyond the playable edge. UVs map world x/y → 0..1 for the fog overlay. */
function useGround(field:Terrain){
  return useMemo(()=>{
    const palette=PALETTES[field.biome],n=field.heights.length-1,step=field.size/n,skirt=14;
    const height=(i:number,j:number)=>{if(i>=0&&j>=0&&i<=n&&j<=n)return field.heights[j][i];const edge=field.heights[Math.max(0,Math.min(n,j))][Math.max(0,Math.min(n,i))];const d=Math.max(-i,i-n,-j,j-n);return Math.max(edge,0)+Math.min(260,d*24)+hash(i,j,field.seed)*45;};
    const vertices:number[]=[],colors:number[]=[],uvs:number[]=[];
    const grass=palette.grass.map(c=>new THREE.Color(c)),bank=new THREE.Color(palette.bank),rock=new THREE.Color(palette.rock),bed=new THREE.Color('#5f7563');
    for(let j=-skirt;j<n+skirt;j++)for(let i=-skirt;i<n+skirt;i++){
      const v=[[i,j],[i+1,j],[i,j+1],[i+1,j+1]].map(([a,b])=>({x:a*step,y:b*step,h:height(a,b)}));
      const tris=hash(i,j,field.seed)>.5?[[0,2,1],[1,2,3]]:[[0,2,3],[0,3,1]];
      for(let t=0;t<2;t++){
        const avg=tris[t].reduce((s,k)=>s+v[k].h,0)/3,inside=i>=0&&j>=0&&i<n&&j<n;
        const c=(avg<-8?bed:avg<12?bank:field.biome==='highland'&&avg>150?rock:grass[Math.floor(hash(i,j,field.seed+8)*4)]).clone();
        c.multiplyScalar((inside?.91:.8)+hash(i*2+t,j,field.seed+20)*.18);
        for(const k of tris[t]){const p=v[k];vertices.push(p.x*SCALE-half(field),p.h*SCALE,p.y*SCALE-half(field));colors.push(c.r,c.g,c.b);uvs.push(p.x/field.size,p.y/field.size);}
      }
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.computeVertexNormals();return geo;
  },[field]);
}

function Ground({field,fogTexture}:{field:Terrain;fogTexture:THREE.Texture|null}){
  const geometry=useGround(field);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  const extent=field.size*SCALE+40;
  return <>
    <mesh geometry={geometry} receiveShadow><meshStandardMaterial vertexColors roughness={1} flatShading/></mesh>
    {fogTexture&&<mesh geometry={geometry} renderOrder={2}><meshBasicMaterial map={fogTexture} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2}/></mesh>}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.12,0]} receiveShadow><planeGeometry args={[extent,extent]}/><meshStandardMaterial color={PALETTES[field.biome].water} roughness={.3} metalness={.1} transparent opacity={.92}/></mesh>
  </>;
}

type Instance={p:[number,number,number];s:[number,number,number];r:number;color:string};
function Instances({items,kind}:{items:Instance[];kind:'cone'|'trunk'|'rock'}){
  const ref=useRef<THREE.InstancedMesh>(null);
  useEffect(()=>{if(!ref.current)return;const obj=new THREE.Object3D();items.forEach((a,i)=>{obj.position.set(...a.p);obj.rotation.set(0,a.r,kind==='rock'?a.r*.2:0);obj.scale.set(...a.s);obj.updateMatrix();ref.current!.setMatrixAt(i,obj.matrix);ref.current!.setColorAt(i,new THREE.Color(a.color));});ref.current.instanceMatrix.needsUpdate=true;if(ref.current.instanceColor)ref.current.instanceColor.needsUpdate=true;},[items,kind]);
  if(!items.length)return null;
  return <instancedMesh key={items.length} ref={ref} args={[undefined,undefined,items.length]} castShadow receiveShadow frustumCulled={false}>{kind==='cone'?<coneGeometry args={[1,1,6]}/>:kind==='trunk'?<cylinderGeometry args={[.08,.13,1,5]}/>:<dodecahedronGeometry args={[1,0]}/>}<meshStandardMaterial roughness={1} flatShading/></instancedMesh>;
}

/** Trees fill each forest circle (sunflower spread) so the drawn grove matches the blocking footprint. */
function Vegetation({field}:{field:Terrain}){
  const data=useMemo(()=>{
    const cones:Instance[]=[],trunks:Instance[]=[],rocks:Instance[]=[];const palette=PALETTES[field.biome];
    const tree=(x:number,z:number,h:number,v:number)=>{const s=1+v*.75;trunks.push({p:[x,h+s*.4,z],s:[s,s*.8,s],r:v*6,color:'#716549'});for(let i=0;i<3;i++)cones.push({p:[x,h+s*(.65+i*.48),z],s:[s*(.62-i*.14),s*.95,s*(.62-i*.14)],r:v*6+i*.3,color:palette.tree[i]});};
    field.obstacles.forEach((o,k)=>{
      if(o.kind==='forest'){const count=Math.max(1,Math.min(45,Math.round(Math.PI*o.r*o.r/4200)));for(let t=0;t<count;t++){const v=hash(k,t,field.seed),rad=o.r*.9*Math.sqrt((t+.5)/count),a=t*2.39996+v;const x=o.x+Math.cos(a)*rad,y=o.y+Math.sin(a)*rad;const p=toScene(field,x,y);tree(p[0],p[2],heightAt(field,x,y)*SCALE,v);}}
      if(o.kind==='rock'){const v=hash(k,1,field.seed),p=toScene(field,o.x,o.y),r=o.r*SCALE;rocks.push({p:[p[0],p[1]+r*.25,p[2]],s:[r*.95,r*(.55+v*.45),r*.85],r:v*6,color:palette.rock});for(let t=0;t<2;t++){const a=v*9+t*2.6,q=toScene(field,o.x+Math.cos(a)*o.r*.9,o.y+Math.sin(a)*o.r*.9);rocks.push({p:[q[0],q[1]+.1,q[2]],s:[r*.35,r*.3,r*.3],r:a,color:palette.rock});}}
    });
    // Decorative ring of forest and boulders beyond the playable edge.
    const n=field.heights.length-1,step=field.size/n;
    for(let j=-12;j<n+12;j+=2)for(let i=-12;i<n+12;i+=2){if(i>=-1&&j>=-1&&i<=n+1&&j<=n+1)continue;const v=hash(i,j,field.seed);const d=Math.max(-i,i-n,-j,j-n);const h=(Math.max(field.heights[Math.max(0,Math.min(n,j))][Math.max(0,Math.min(n,i))],0)+Math.min(260,d*24))*SCALE;const x=i*step*SCALE-half(field),z=j*step*SCALE-half(field);if(v>.42)tree(x+v,z-v,h,v);else if(v<.16)rocks.push({p:[x,h,z],s:[1.4+v*3,1.6+v*4,1.5],r:v*12,color:palette.rock});}
    return{cones,trunks,rocks};
  },[field]);
  return <><Instances items={data.trunks} kind="trunk"/><Instances items={data.cones} kind="cone"/><Instances items={data.rocks} kind="rock"/></>;
}

function Bridges({field}:{field:Terrain}){return <>{field.bridges.map((b,i)=>{const p=toScene(field,b.x,b.y);const length=b.length*SCALE,width=b.width*SCALE;return <group key={i} position={[p[0],.16,p[2]]} rotation={[0,-b.angle,0]}>
  <mesh receiveShadow castShadow><boxGeometry args={[length,.3,width*.8]}/><meshStandardMaterial color="#a2946e"/></mesh>
  {[-1,1].map(s=><mesh key={s} position={[0,.32,s*width*.4]} castShadow><boxGeometry args={[length,.14,.12]}/><meshStandardMaterial color="#5e624c"/></mesh>)}
  {Array.from({length:Math.floor(length/.9)},(_,k)=><mesh key={k} position={[-length/2+.45+k*.9,.16,0]}><boxGeometry args={[.05,.02,width*.78]}/><meshStandardMaterial color="#605b46"/></mesh>)}
</group>;})}</>;}

function Base({field,side}:{field:Terrain;side:Side}){
  const [x,y]=field.bases[side];const p=toScene(field,x,y);const color=TEAM[side];
  return <group position={p}>
    <mesh receiveShadow castShadow position={[0,.15,0]}><cylinderGeometry args={[5.2,5.8,.5,6]}/><meshStandardMaterial color="#4a5948" flatShading/></mesh>
    <mesh position={[0,.42,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[4.4,4.75,6]}/><meshBasicMaterial color={color} transparent opacity={.75}/></mesh>
    {[0,1,2,3,4,5].map(k=><mesh key={k} castShadow position={[Math.cos(k*Math.PI/3)*4.6,1.1,Math.sin(k*Math.PI/3)*4.6]}><boxGeometry args={[.5,1.6,.5]}/><meshStandardMaterial color="#d1d5bd" flatShading/></mesh>)}
    <mesh castShadow position={[0,2.2,0]}><cylinderGeometry args={[.35,.7,3.6,6]}/><meshStandardMaterial color="#d8d4b8" flatShading/></mesh>
    <mesh position={[0,4.4,0]}><octahedronGeometry args={[.7,0]}/><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.7}/></mesh>
    <group position={[0,6,0]}><WorldLabel text={`${SIDE_NAME[side]} BASE`} color={color} scale={1.4}/></group>
  </group>;
}

function Beacon({field,name,index,owner}:{field:Terrain;name:string;index:number;owner?:string|null}){
  const [x,y]=field.beacons[name];const color=owner==='cyan'?TEAM.cyan:owner==='amber'?TEAM.amber:'#f5e8b0';const p=toScene(field,x,y);
  const ring=useMemo(()=>drape(field,circle(x,y,RULES.capture),.12),[field,x,y]);
  return <>
    <group position={[p[0],p[1]+.1,p[2]]} scale={2}>
      <mesh castShadow><cylinderGeometry args={[.42,.5,.19,6]}/><meshStandardMaterial color="#495849"/></mesh><mesh position={[0,.5,0]} castShadow><cylinderGeometry args={[.065,.1,.8,6]}/><meshStandardMaterial color="#ddd7b9"/></mesh><mesh position={[0,1.08,0]}><octahedronGeometry args={[.23,0]}/><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.6}/></mesh>
      <group position={[0,1.75,0]}><WorldLabel text={`${String.fromCharCode(65+index)} / ${name.toUpperCase()}`} color={color} scale={.7}/></group>
    </group>
    <Line points={ring} color={color} lineWidth={2} transparent opacity={.85} dashed dashSize={.6} gapSize={.35}/>
  </>;
}

function pointAlong(points:THREE.Vector3[],distance:number){for(let i=1;i<points.length;i++){const step=points[i].distanceTo(points[i-1]);if(distance<=step)return points[i-1].clone().lerp(points[i],step?distance/step:1);distance-=step;}return points[points.length-1].clone();}

function Robot({unit,field,selected,onSelect,reduced,commander=false}:{unit:Unit;field:Terrain;selected:boolean;onSelect:()=>void;reduced:boolean;commander?:boolean}){
  const ref=useRef<THREE.Group>(null),body=useRef<THREE.Group>(null);const color=TEAM[unit.side];const armor=unit.side==='cyan'?'#d1dfc4':'#e2c7a0';
  const route=useMemo(()=>(unit.path&&unit.path.length>1?drape(field,unit.path,.13):[toScene(field,unit.x,unit.y,.13)]).map(p=>new THREE.Vector3(...p)),[field,unit.path,unit.x,unit.y]);
  const total=useMemo(()=>route.reduce((s,p,i)=>i?s+p.distanceTo(route[i-1]):0,0),[route]);
  const anim=useRef<{route:THREE.Vector3[]|null;start:number}>({route:null,start:0});
  const centre=toScene(field,field.size/2,field.size/2);
  useFrame(({clock})=>{
    if(!ref.current||!body.current)return;
    if(anim.current.route!==route)anim.current={route,start:clock.elapsedTime};
    const t=reduced||total===0?1:Math.min(1,(clock.elapsedTime-anim.current.start)/MOVE_SECONDS);
    const eased=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
    const p=pointAlong(route,eased*total);ref.current.position.copy(p);
    const ahead=t<1?pointAlong(route,Math.min(total,eased*total+.5)):null;
    const dir=ahead&&ahead.distanceToSquared(p)>1e-4?ahead.sub(p):new THREE.Vector3(centre[0]-p.x,0,centre[2]-p.z);
    const heading=Math.atan2(dir.x,dir.z);const delta=Math.atan2(Math.sin(heading-body.current.rotation.y),Math.cos(heading-body.current.rotation.y));
    body.current.rotation.y+=reduced?delta:delta*Math.min(1,.15+(t<1?.25:.05));
  });
  return <group ref={ref} position={route[route.length-1]} onClick={e=>{e.stopPropagation();onSelect();}} onDoubleClick={e=>{e.stopPropagation();cameraBus.focus([unit.x,unit.y]);}}>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.04,0]}><ringGeometry args={[selected?.95:.7,selected?1.05:.78,48]}/><meshBasicMaterial color={color} transparent opacity={selected?1:.65} depthWrite={false}/></mesh>
    {selected&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.03,0]}><circleGeometry args={[.95,40]}/><meshBasicMaterial color={color} transparent opacity={.16} depthWrite={false}/></mesh>}
    <group ref={body} scale={ROBOT*(commander?1.15:1)}>
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
    {unit.shield>0&&<mesh position={[0,.9,0]}><sphereGeometry args={[1.2,16,12]}/><meshBasicMaterial color={color} transparent opacity={.12} wireframe/></mesh>}
    <group position={[0,commander?2.9:2.55,0]}><WorldLabel text={commander?'SPARK / CMD':ROLES[unit.role].name} color={color} selected={selected} hp={commander?undefined:unit.hp}/></group>
  </group>;
}

/** Trail of this turn's move and the requested destination. */
function Route({field,unit,selected}:{field:Terrain;unit:Unit;selected:boolean}){
  const points=useMemo(()=>unit.path&&unit.path.length>1?drape(field,unit.path,.18):null,[field,unit.path]);
  const goal=unit.goal&&Math.hypot(unit.goal[0]-unit.x,unit.goal[1]-unit.y)>60?unit.goal:null;
  const goalLine=useMemo(()=>goal?drape(field,[[unit.x,unit.y],goal],.18):null,[field,goal,unit.x,unit.y]);
  const color=TEAM[unit.side];
  return <>
    {points&&<Line points={points} color={color} lineWidth={selected?3:1.6} transparent opacity={selected?.95:.55}/>}
    {goalLine&&<Line points={goalLine} color={color} lineWidth={1} transparent opacity={selected?.6:.25} dashed dashSize={.5} gapSize={.5}/>}
    {goal&&<group position={toScene(field,goal[0],goal[1],.2)}><mesh rotation={[-Math.PI/2,0,Math.PI/4]}><ringGeometry args={[.45,.6,4]}/><meshBasicMaterial color={color} transparent opacity={selected?.95:.5} depthWrite={false}/></mesh></group>}
  </>;
}

function Ranges({field,unit,round}:{field:Terrain;unit:Unit;round:number}){
  const rings=useMemo(()=>[[sensorRange(unit,round),'#e9f3cf',.55],[RULES.pulse[unit.role],'#ff8f6b',.75],...(unit.role==='support'?[[RULES.repair,'#9de8b0',.6]]:[])].map(([r,c,o])=>({points:drape(field,circle(unit.x,unit.y,r as number,96),.16),color:c as string,opacity:o as number})),[field,unit,round]);
  return <>{rings.map((r,i)=><Line key={i} points={r.points} color={r.color} lineWidth={i===0?1.4:1.8} transparent opacity={r.opacity} dashed={i===0} dashSize={.8} gapSize={.5}/>)}</>;
}

/** Dark overlay for ground outside the active side's sensors, using the engine's range and sight rules. */
function useFog(field:Terrain,units:Unit[],side:Side,round:number,enabled:boolean){
  const texture=useMemo(()=>{
    if(!enabled)return null;
    const res=128,canvas=document.createElement('canvas');canvas.width=canvas.height=res;const ctx=canvas.getContext('2d')!;const image=ctx.createImageData(res,res);
    const own=units.filter(u=>u.side===side&&u.hp>0).map(u=>({u,r:sensorRange(u,round),near:{...field,obstacles:field.obstacles.filter(o=>o.kind!=='water'&&Math.hypot(o.x-u.x,o.y-u.y)<sensorRange(u,round)+o.r)}}));
    for(let j=0;j<res;j++)for(let i=0;i<res;i++){const x=(i+.5)*field.size/res,y=(j+.5)*field.size/res;const seen=own.some(({u,r,near})=>Math.hypot(x-u.x,y-u.y)<=r&&sightClear(near,[u.x,u.y],[x,y]));const k=(j*res+i)*4;image.data[k]=12;image.data[k+1]=26;image.data[k+2]=20;image.data[k+3]=seen?0:150;}
    ctx.putImageData(image,0,0);const t=new THREE.CanvasTexture(canvas);t.flipY=false;t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;return t;
  },[field,units,side,round,enabled]);
  useEffect(()=>()=>texture?.dispose(),[texture]);
  return texture;
}

/** Orthographic RTS camera: WASD / arrow / screen-edge pan, minimap focus, footprint reporting for the minimap. */
function CameraRig({field,resetCamera}:{field:Terrain;resetCamera:number}){
  const {camera,size,gl}=useThree();const controls=useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const keys=useRef(new Set<string>()),pointer=useRef<{x:number;y:number}|null>(null),goal=useRef<THREE.Vector3|null>(null),published=useRef(0);
  const light=useRef<THREE.DirectionalLight>(null);
  const fit=Math.min(size.width/150,size.height/105);
  useEffect(()=>{if(!(camera instanceof THREE.OrthographicCamera))return;camera.position.copy(CAMERA_OFFSET);camera.zoom=fit;camera.updateProjectionMatrix();controls.current?.target.set(0,0,0);controls.current?.update();goal.current=null;},[camera,fit,field.seed,resetCamera]);
  useEffect(()=>cameraBus.onFocus(([x,y])=>{const p=toScene(field,x,y);goal.current=new THREE.Vector3(p[0],0,p[2]);if(camera instanceof THREE.OrthographicCamera&&camera.zoom<fit*3){camera.zoom=fit*3;camera.updateProjectionMatrix();}}),[camera,field,fit]);
  useEffect(()=>{
    const typing=(e:Event)=>!!(e.target as HTMLElement)?.closest?.('input,textarea,select,[role="dialog"]');
    const down=(e:KeyboardEvent)=>{if(typing(e)||e.metaKey||e.ctrlKey)return;const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){keys.current.add(k);if(k.startsWith('arrow'))e.preventDefault();}};
    const up=(e:KeyboardEvent)=>keys.current.delete(e.key.toLowerCase());
    const move=(e:MouseEvent)=>{pointer.current={x:e.clientX,y:e.clientY};};
    const leave=(e:MouseEvent)=>{if(!e.relatedTarget)pointer.current=null;};
    const blur=()=>{keys.current.clear();pointer.current=null;};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('mousemove',move);document.addEventListener('mouseout',leave);window.addEventListener('blur',blur);
    return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('mousemove',move);document.removeEventListener('mouseout',leave);window.removeEventListener('blur',blur);};
  },[]);
  const ray=useMemo(()=>new THREE.Raycaster(),[]);const ground=useMemo(()=>new THREE.Plane(new THREE.Vector3(0,1,0),0),[]);
  useFrame(({clock},delta)=>{
    const c=controls.current;if(!c||!(camera instanceof THREE.OrthographicCamera))return;
    const forward=new THREE.Vector3();camera.getWorldDirection(forward);forward.y=0;forward.normalize();const right=new THREE.Vector3().crossVectors(forward,camera.up).normalize();
    let kx=0,ky=0;const k=keys.current;if(k.has('a')||k.has('arrowleft'))kx--;if(k.has('d')||k.has('arrowright'))kx++;if(k.has('w')||k.has('arrowup'))ky++;if(k.has('s')||k.has('arrowdown'))ky--;
    const p=pointer.current,edge=14;if(p&&document.hasFocus()){if(p.x<edge)kx--;if(p.x>window.innerWidth-edge)kx++;if(p.y<edge)ky++;if(p.y>window.innerHeight-edge)ky--;}
    const shift=new THREE.Vector3();
    if(kx||ky){goal.current=null;shift.addScaledVector(right,kx).addScaledVector(forward,ky).setLength(size.width/camera.zoom*.75*Math.min(delta,.05));}
    else if(goal.current){shift.subVectors(goal.current,c.target).multiplyScalar(Math.min(1,delta*7));if(shift.lengthSq()<1e-4)goal.current=null;}
    const limit=half(field)+4,next=c.target.clone().add(shift);next.x=Math.max(-limit,Math.min(limit,next.x));next.z=Math.max(-limit,Math.min(limit,next.z));next.y=0;
    shift.subVectors(next,c.target);if(shift.lengthSq()>0){c.target.add(shift);camera.position.add(shift);c.update();}
    if(light.current){const width=size.width/camera.zoom;light.current.position.set(c.target.x-24,48,c.target.z-18);light.current.target.position.copy(c.target);light.current.target.updateMatrixWorld();const cam=light.current.shadow.camera;const extent=Math.min(90,width*.75);if(Math.abs(cam.right-extent)>1){cam.left=cam.bottom=-extent;cam.right=cam.top=extent;cam.updateProjectionMatrix();}}
    if(clock.elapsedTime-published.current>.1){published.current=clock.elapsedTime;const footprint:Point[]=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>{ray.setFromCamera(new THREE.Vector2(x,y),camera);const hit=new THREE.Vector3();return ray.ray.intersectPlane(ground,hit)?toWorld(field,hit):toWorld(field,c.target);});cameraBus.setView({center:toWorld(field,c.target),footprint});}
  });
  return <>
    <directionalLight ref={light} intensity={3.4} color="#fff1cb" castShadow shadow-mapSize={[2048,2048]} shadow-bias={-.0003} shadow-normalBias={.07} shadow-camera-near={1} shadow-camera-far={160}/>
    <OrbitControls ref={controls} makeDefault enablePan screenSpacePanning={false} minZoom={fit*.8} maxZoom={140} minPolarAngle={.35} maxPolarAngle={1.2} target={[0,0,0]} mouseButtons={{LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN}} domElement={gl.domElement}/>
  </>;
}

function World({field,frame,selected,side,onSelect,reduced,resetCamera,fog}:{field:Terrain;frame:Frame|null;selected:string;side:Side;onSelect:(id:string)=>void;reduced:boolean;resetCamera:number;fog:boolean}){
  const units=useMemo(()=>frame?.units||previewUnits(field),[frame,field]);const round=frame?.round||0;
  const visible=useMemo(()=>{const own=units.filter(u=>u.side===side&&u.hp>0);return new Set(units.filter(u=>!fog||u.side===side||own.some(a=>canSee(field,a,u,round))).map(u=>u.id));},[units,side,fog,field,round]);
  const fogTexture=useFog(field,units,side,round,fog);
  const selectedUnit=units.find(u=>u.id===selected&&u.hp>0&&visible.has(u.id));
  return <>
    <color attach="background" args={['#b9c7ad']}/><fog attach="fog" args={['#b9c7ad',150,280]}/>
    <ambientLight intensity={.65}/><hemisphereLight args={['#fff2d6','#4f6550',1.65]}/>
    <CameraRig field={field} resetCamera={resetCamera}/>
    <Ground field={field} fogTexture={fogTexture}/><Vegetation field={field}/><Bridges field={field}/>
    {(['cyan','amber'] as Side[]).map(s=><Base key={s} field={field} side={s}/>)}
    {BEACONS.filter(n=>field.beacons[n]).map((name,i)=><Beacon key={name} field={field} name={name} index={i} owner={frame?.owners[name]}/>)}
    {selectedUnit&&<Ranges field={field} unit={selectedUnit} round={round}/>}
    {units.filter(u=>u.hp>0&&visible.has(u.id)).map(u=><Route key={`route-${u.id}`} field={field} unit={u} selected={selected===u.id}/>)}
    {units.filter(u=>u.hp>0&&visible.has(u.id)).map(u=><Robot key={u.id} unit={u} field={field} selected={selected===u.id} onSelect={()=>onSelect(u.id)} reduced={reduced}/>)}
    {(['cyan','amber'] as Side[]).map(s=>{const [bx,by]=field.bases[s];return <Robot key={`${s}-commander`} unit={{id:`${s}-commander`,side:s,role:'vanguard',x:bx,y:by,hp:5,shield:0}} field={field} selected={selected===`${s}-commander`} onSelect={()=>onSelect(`${s}-commander`)} reduced={reduced} commander/>;})}
    {frame?.events.filter(e=>e.kind==='tool'&&e.message.startsWith('pulse(')).map((e,i)=>{const a=units.find(u=>u.id===e.unit_id),b=units.find(u=>u.id===e.message.slice(6,-1));if(!a||!b||!visible.has(a.id))return null;const pa=toScene(field,a.x,a.y,1.1),pb=toScene(field,b.x,b.y,1.1);return <Line key={`${frame.round}-${i}`} points={[pa,pb]} color={TEAM[a.side]} lineWidth={2.5} transparent opacity={.8}/>;})}
  </>;
}

export default function Arena(props:{field:Terrain|null;frame:Frame|null;selected:string;side:Side;onSelect:(id:string)=>void;resetCamera:number;fog:boolean}){
  const [reduced,setReduced]=useState(false);
  useEffect(()=>{const m=window.matchMedia('(prefers-reduced-motion: reduce)');setReduced(m.matches);const change=()=>setReduced(m.matches);m.addEventListener('change',change);return()=>m.removeEventListener('change',change);},[]);
  if(!props.field)return <div className="scene-fallback"><span className="loading-mark"/>전장 지형을 생성하는 중…</div>;
  return <SceneBoundary><Canvas shadows orthographic camera={{position:CAMERA_OFFSET.toArray(),zoom:10,near:.1,far:400}} dpr={[1,1.5]} gl={{antialias:true,toneMapping:THREE.ACESFilmicToneMapping}} fallback={<div className="scene-fallback">WebGL을 지원하는 브라우저에서 3D 전장을 확인하세요.</div>}><Suspense fallback={null}><World {...props} field={props.field} reduced={reduced}/></Suspense></Canvas></SceneBoundary>;
}
