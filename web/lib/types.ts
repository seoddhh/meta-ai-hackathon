export type Side = 'cyan' | 'amber';
export type Role = 'scout' | 'vanguard' | 'support';
export type Biome = 'woodland' | 'highland' | 'wetland';
export type Point = [number, number];
export type Unit = { id: string; side: Side; role: Role; x: number; y: number; hp: number; shield: number; scan_until?: number; path?: Point[]; goal?: Point | null };
export type Obstacle = { kind:'forest'|'rock'|'water'; x:number; y:number; r:number };
export type Bridge = { x:number; y:number; angle:number; length:number; width:number };
export type Terrain = { seed:number; biome:Biome; name:string; size:number; heights:number[][]; obstacles:Obstacle[]; river:{points:Point[];width:number}; bridges:Bridge[]; bases:Record<Side,Point>; beacons:Record<string,Point>; spawns:Record<Side,Point[]> };
export type BattleEvent = { round: number; side: string; kind: string; message: string; unit_id?: string };
export type Frame = { round: number; units: Unit[]; scores: Record<Side, number>; owners: Record<string, string | null>; events: BattleEvent[] };
export type Assignment = {unit_id:string;objective:string;instruction:string};
export type Battle = Frame & {
  id: string; name: string; created_at: string; mode: 'rehearsal' | 'live'; status: 'ready' | 'playing' | 'finished';
  max_rounds: number; prompts: Record<Side, string>; frames: Frame[]; commands: Record<string, string>;
  providers: Record<string, string>; winner: string | null; image_path: string | null;
  field:Terrain; unit_prompts:Record<string,string>; assignments:Record<string,Assignment[]>;
};
export type BattleSummary = Pick<Battle, 'id' | 'name' | 'created_at' | 'mode' | 'status' | 'round' | 'winner' | 'scores' | 'image_path'>;
export type Config = { live_ready: boolean; commander: { name: string; ready: boolean }; worker: { name: string; ready: boolean; provider: string }; image: { name: string; ready: boolean } };
// Mirrors backend/engine.py. World units; the map is 5000 × 5000.
export const RULES = { speed:500, sensor:{scout:1000,vanguard:700,support:700} as Record<Role,number>, scanBonus:400,
  pulse:{scout:350,vanguard:500,support:350} as Record<Role,number>, repair:400, capture:250 };
export const ROLES = {
  scout: { name:'LYNX', ko:'정찰', detail:'시야 1000 · 스캔 +400 · 경로 탐색', short:'SCOUT' },
  vanguard: { name:'ATLAS', ko:'선봉', detail:'펄스 2 · 사거리 500 · 거점 확보', short:'VANGUARD' },
  support: { name:'ECHO', ko:'지원', detail:'아군 복구 400 · 보호막 · 진형 유지', short:'SUPPORT' },
};
export const BEACONS = ['alpha','bravo','charlie'] as const;
export const DEFAULT_PROMPTS: Record<Side,string> = {
  cyan:'정찰대는 알파 거점을 확보하고, 선봉은 브라보를 지켜. 지원대는 손상된 아군을 수리해.',
  amber:'찰리 거점을 먼저 확보해. 선봉은 브라보로 전진하고 지원대는 대형을 유지해.',
};
export const BIOMES:Record<Biome,{name:string;ko:string}>={woodland:{name:'WHISPERING PINES',ko:'침엽수림'},highland:{name:'GRANITE PASS',ko:'암석 고지대'},wetland:{name:'MISTWATER BASIN',ko:'강변 습지'}};
export function sensorRange(unit:Unit,round:number){return RULES.sensor[unit.role]+((unit.scan_until||0)>round?RULES.scanBonus:0);}
function segmentDistance(p:Point,a:Point,b:Point){const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;const t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
/** Same test as backend/navigation.sight_clear: forest and rock circles block sight, water does not. */
export function sightClear(field:Terrain,a:Point,b:Point){for(const o of field.obstacles){if(o.kind!=='water'&&segmentDistance([o.x,o.y],a,b)<o.r)return false;}return true;}
export function canSee(field:Terrain,viewer:Unit,target:Unit,round:number){return Math.hypot(viewer.x-target.x,viewer.y-target.y)<=sensorRange(viewer,round)&&sightClear(field,[viewer.x,viewer.y],[target.x,target.y]);}
export function previewUnits(field:Terrain):Unit[]{return (['cyan','amber'] as Side[]).flatMap(side=>(['scout','vanguard','support'] as Role[]).map((role,i)=>({id:`${side}-${role}`,side,role,x:field.spawns[side][i][0],y:field.spawns[side][i][1],hp:5,shield:0})));}
