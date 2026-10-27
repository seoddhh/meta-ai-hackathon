import asyncio
import base64
import hmac
import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from .engine import BEACONS, SIZE, WALLS, snapshot
from .models import AdvanceBattle, Battle, CreateBattle, Event, PromptUpdate, TerrainRequest, Unit
from .terrain import generate
from .orchestration import round_graph
from .providers import ProviderError, configuration
from .store import Store

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')
DATA = Path(os.getenv('DATA_DIR', str(ROOT / '.data')))
store = Store(DATA)
locks: dict[str, asyncio.Lock] = {}
app = FastAPI(title='Signal War', version='0.1.0')


@app.middleware('http')
async def authenticate(request: Request, call_next):
    token = os.getenv('BACKEND_TOKEN')
    if token and not hmac.compare_digest(request.headers.get('x-backend-token', ''), token):
        return JSONResponse({'detail': 'Backend authentication required'}, status_code=401)
    return await call_next(request)


def get_battle(battle_id: str) -> Battle:
    battle = store.get(battle_id)
    if not battle:
        raise HTTPException(404, '경기를 찾을 수 없습니다.')
    return battle


def lock_for(battle_id: str):
    return locks.setdefault(battle_id, asyncio.Lock())


@app.get('/health')
def health():
    return {'ok': True}


@app.get('/config')
def config():
    return {**configuration(), 'map': {'size': SIZE, 'walls': sorted(WALLS), 'beacons': BEACONS}}


@app.get('/battles')
def list_battles():
    return store.list()


@app.post('/terrain')
def terrain(body: TerrainRequest):
    return generate(body.seed, body.biome)


@app.post('/battles', status_code=201)
def create_battle(body: CreateBattle):
    conf = configuration()
    if body.mode == 'live' and not conf['live_ready']:
        raise HTTPException(503, 'Spark 사령관과 수행자 모델 연결을 모두 설정해야 합니다. Glimmer는 별도 추론 주소가 필요합니다.')
    field = generate(body.seed, body.biome)
    battle = Battle(id=uuid4().hex, created_at=datetime.now(timezone.utc).isoformat(), name=field.name,
                    mode=body.mode, prompts={'cyan': body.cyan_prompt, 'amber': body.amber_prompt},
                    field=field, max_rounds=24,
                    units=[Unit(id=f'{side}-{role}', side=side, role=role, x=point[0], y=point[1])
                           for side in ('cyan', 'amber')
                           for role, point in zip(('scout', 'vanguard', 'support'), field.spawns[side])],
                    providers={'commander': conf['commander']['name'], 'worker': conf['worker']['name']}
                    if body.mode == 'live' else {'commander': '규칙 기반 테스트 정책', 'worker': '규칙 기반 테스트 정책'})
    battle.events.extend(Event(round=0, side=s, kind='briefing', message=p) for s, p in battle.prompts.items())
    battle.frames.append(snapshot(battle))
    store.save(battle)
    return battle


@app.get('/battles/{battle_id}')
def detail(battle_id: str):
    return get_battle(battle_id)


@app.patch('/battles/{battle_id}/strategy')
async def strategy(battle_id: str, body: PromptUpdate):
    async with lock_for(battle_id):
        battle = get_battle(battle_id)
        if battle.status == 'finished':
            raise HTTPException(409, '종료된 경기의 전략은 변경할 수 없습니다.')
        if body.unit_id:
            unit = next((u for u in battle.units if u.id == body.unit_id), None)
            if not unit or unit.side != body.side or unit.hp <= 0:
                raise HTTPException(422, '현재 팀의 활성 에이전트에게만 명령할 수 있습니다.')
            battle.unit_prompts[body.unit_id] = body.prompt
        else:
            battle.prompts[body.side] = body.prompt
        battle.events.append(Event(round=battle.round, side=body.side, kind='briefing', message=body.prompt, unit_id=body.unit_id))
        store.save(battle)
        return battle


@app.post('/battles/{battle_id}/advance')
async def advance(battle_id: str, body: AdvanceBattle):
    async with lock_for(battle_id):
        battle = get_battle(battle_id)
        if battle.round != body.expected_round or battle.status == 'finished':
            raise HTTPException(409, '경기 상태가 바뀌었습니다. 새로고침 후 다시 진행하세요.')
        try:
            state = await round_graph.ainvoke({'battle': battle})
        except ProviderError as exc:
            raise HTTPException(502, str(exc)) from exc
        battle = state['battle']
        store.save(battle)
        return battle


@app.post('/battles/{battle_id}/image')
async def generate_image(battle_id: str):
    async with lock_for(battle_id):
        battle = get_battle(battle_id)
        if battle.status != 'finished':
            raise HTTPException(409, '경기 종료 후 결과 이미지를 만들 수 있습니다.')
        if battle.image_path:
            return battle
        if not os.getenv('MODEL_API_KEY'):
            raise HTTPException(503, 'Muse Image에 연결하려면 MODEL_API_KEY가 필요합니다.')
        # Only the adjudicated record supplies facts; player text never enters the image prompt.
        prompt = ('Create a polished cinematic isometric 3D collectible match illustration for SIGNAL WAR, '
                  'a fictional non-lethal robot sport on a low-poly natural forest battlefield. '
                  'Cyan and amber robot squads, three luminous signal beacons, pine trees, angular cliffs, winding river, wooden bridges. '
                  'No humans, real-world military references, weapons, gore, or readable text. '
                  'Use this verified game result for the composition; do not invent a different winner: '
                  f'winner={battle.winner}, score={battle.scores}, rounds={battle.round}, biome={battle.field.biome if battle.field else "arena"}. '
                  'Highlight the winning color, or show balanced colors for a draw. This is an artistic recap, not the source of the result.')
        try:
            async with httpx.AsyncClient(timeout=150) as client:
                r = await client.post(f'{os.getenv("META_BASE_URL", "https://api.meta.ai/v1").rstrip("/")}/images/generations',
                                      headers={'Authorization': f'Bearer {os.environ["MODEL_API_KEY"]}'},
                                      json={'model': 'muse-image-1.0', 'prompt': prompt, 'n': 1,
                                            'response_format': 'b64_json', 'output_format': 'png'})
                if r.status_code >= 400:
                    raise HTTPException(502, f'Muse Image HTTP {r.status_code}. 결과 기록은 저장되어 있습니다.')
                item = r.json()['data'][0]
                raw = base64.b64decode(item['b64_json'], validate=True)
                if not raw.startswith(b'\x89PNG\r\n\x1a\n') or len(raw) > 30_000_000:
                    raise ValueError('invalid image')
        except (httpx.HTTPError, KeyError, ValueError, IndexError) as exc:
            raise HTTPException(502, 'Muse Image 연결 또는 이미지 검증 실패. 다시 시도할 수 있습니다.') from exc
        directory = DATA / 'images'
        directory.mkdir(exist_ok=True)
        (directory / f'{battle.id}.png').write_bytes(raw)
        battle.image_path = f'/battles/{battle.id}/image'
        store.save(battle)
        return battle


@app.get('/battles/{battle_id}/image')
def image(battle_id: str):
    battle = get_battle(battle_id)
    path = DATA / 'images' / f'{battle.id}.png'
    if not battle.image_path or not path.is_file():
        raise HTTPException(404, '생성된 이미지가 없습니다.')
    return FileResponse(path, media_type='image/png')
