export type Side = 'cyan' | 'amber';
export type Role = 'scout' | 'vanguard' | 'support';
export type Biome = 'woodland' | 'highland' | 'wetland';
export type Unit = { id: string; side: Side; role: Role; x: number; y: number; hp: number; shield: number; scan_until?: number };
export type Cell = { x:number; y:number; height:number; kind:'grass'|'forest'|'rock'|'water'|'path'|'bridge'; blocked:boolean; variant:number };
export type Terrain = { seed:number; biome:Biome; name:string; size:number; heights:number[][]; cells:Cell[]; beacons:Record<string,[number,number]>; spawns:Record<Side,[number,number][]> };
export type BattleEvent = { round: number; side: string; kind: string; message: string; unit_id?: string };
export type Frame = { round: number; units: Unit[]; scores: Record<Side, number>; owners: Record<string, string | null>; events: BattleEvent[] };
export type Assignment = {unit_id:string;objective:string;instruction:string};
export type Battle = Frame & {
  id: string; name: string; created_at: string; mode: 'rehearsal' | 'live'; status: 'ready' | 'playing' | 'finished';
  max_rounds: number; prompts: Record<Side, string>; frames: Frame[]; commands: Record<string, string>;
  providers: Record<string, string>; winner: string | null; image_path: string | null;
  field:Terrain|null; unit_prompts:Record<string,string>; assignments:Record<string,Assignment[]>;
};
export type BattleSummary = Pick<Battle, 'id' | 'name' | 'created_at' | 'mode' | 'status' | 'round' | 'winner' | 'scores' | 'image_path'>;
export type Config = { live_ready: boolean; commander: { name: string; ready: boolean }; worker: { name: string; ready: boolean; provider: string }; image: { name: string; ready: boolean } };
export const ROLES = {
  scout: { name:'LYNX', ko:'정찰', detail:'시야 5 · 스캔 · 경로 탐색', short:'SCOUT' },
  vanguard: { name:'ATLAS', ko:'선봉', detail:'펄스 2 · 사거리 3 · 거점 확보', short:'VANGUARD' },
  support: { name:'ECHO', ko:'지원', detail:'아군 복구 · 보호막 · 진형 유지', short:'SUPPORT' },
};
export const INITIAL_UNITS: Unit[] = (['cyan','amber'] as Side[]).flatMap(side =>
  (['scout','vanguard','support'] as Role[]).map((role,i)=>({id:`${side}-${role}`,side,role,x:side==='cyan'?1:9,y:side==='cyan'?[2,5,8][i]:[8,5,2][i],hp:5,shield:0})));
export const DEFAULT_PROMPTS: Record<Side,string> = {
  cyan:'정찰대는 북쪽 거점을 확보하고, 선봉은 중앙을 지켜. 지원대는 손상된 아군을 수리해.',
  amber:'남쪽 거점을 먼저 확보해. 선봉은 중앙으로 전진하고 지원대는 대형을 유지해.',
};
export const BIOMES:Record<Biome,{name:string;ko:string}>={woodland:{name:'WHISPERING PINES',ko:'침엽수림'},highland:{name:'GRANITE PASS',ko:'암석 고지대'},wetland:{name:'MISTWATER BASIN',ko:'강변 습지'}};
export function previewUnits(field:Terrain):Unit[]{return (['cyan','amber'] as Side[]).flatMap(side=>(['scout','vanguard','support'] as Role[]).map((role,i)=>({id:`${side}-${role}`,side,role,x:field.spawns[side][i][0],y:field.spawns[side][i][1],hp:5,shield:0})));}
