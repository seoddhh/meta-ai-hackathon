import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.store import Store


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'store', Store(tmp_path))
    monkeypatch.setattr(main, 'DATA', tmp_path)
    monkeypatch.delenv('BACKEND_TOKEN', raising=False)
    monkeypatch.delenv('GLIMMER_BASE_URL', raising=False)
    monkeypatch.delenv('BASETEN_API_KEY', raising=False)
    monkeypatch.setenv('WORKER_PROVIDER', 'glimmer')
    with TestClient(main.app) as c:
        yield c


def test_create_advance_replay_and_round_conflict(client):
    r = client.post('/battles', json={})
    assert r.status_code == 201
    b = r.json()
    assert b['max_rounds'] == 30 and b['field']['size'] == 5000
    assert b['providers']['worker'] == '규칙 기반 테스트 정책'
    path = f'/battles/{b["id"]}'
    assert client.post(path+'/advance', json={'expected_round': 0}).status_code == 200
    assert client.post(path+'/advance', json={'expected_round': 0}).status_code == 409
    for n in range(1, b['max_rounds']):
        result = client.post(path+'/advance', json={'expected_round': n})
        assert result.status_code == 200
    assert result.json()['status'] == 'finished'
    assert len(client.get(path).json()['frames']) == b['max_rounds'] + 1
    assert client.patch(path+'/strategy', json={'side': 'cyan', 'prompt': '변경'}).status_code == 409
    assert client.get('/battles').json()[0]['id'] == b['id']


def test_live_mode_never_silently_substitutes_for_glimmer(client):
    assert client.get('/config').json()['live_ready'] is False
    r = client.post('/battles', json={'mode': 'live'})
    assert r.status_code == 503
    assert client.get('/battles').json() == []


def test_image_generation_requires_finished_match(client):
    b = client.post('/battles', json={}).json()
    assert client.post(f'/battles/{b["id"]}/image').status_code == 409


def test_external_backend_token_is_enforced(client, monkeypatch):
    monkeypatch.setenv('BACKEND_TOKEN', 'test-server-token')
    assert client.get('/battles').status_code == 401
    assert client.get('/battles', headers={'x-backend-token': 'test-server-token'}).status_code == 200


def test_model_failure_never_commits_or_switches_mode(client, monkeypatch):
    from types import SimpleNamespace
    from backend.providers import ProviderError
    b = client.post('/battles', json={}).json()
    async def fail(_):
        raise ProviderError('수행자 연결 실패')
    monkeypatch.setattr(main, 'round_graph', SimpleNamespace(ainvoke=fail))
    path = f'/battles/{b["id"]}'
    assert client.post(path+'/advance', json={'expected_round': 0}).status_code == 502
    unchanged = client.get(path).json()
    assert unchanged['round'] == 0
    assert len(unchanged['frames']) == 1


def test_generated_image_is_persisted_and_not_generated_twice(client, monkeypatch):
    import base64
    b = client.post('/battles', json={}).json()
    stored = main.store.get(b['id'])
    stored.status = 'finished'
    stored.winner = 'draw'
    main.store.save(stored)
    monkeypatch.setenv('MODEL_API_KEY', 'test-key-not-real')
    calls = []
    raw = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=')
    class ImageResponse:
        status_code = 200
        def json(self):
            return {'data': [{'b64_json': base64.b64encode(raw).decode()}]}
    class ImageClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs):
            calls.append(kwargs['json'])
            return ImageResponse()
    monkeypatch.setattr(main.httpx, 'AsyncClient', ImageClient)
    path = f'/battles/{b["id"]}/image'
    assert client.post(path).status_code == 200
    assert client.post(path).status_code == 200
    assert len(calls) == 1
    assert client.get(path).content == raw
    assert 'winner=draw' in calls[0]['prompt']


def test_map_preview_matches_created_game_and_agent_order_ownership(client):
    preview = client.post('/terrain', json={'seed': 512, 'biome':'wetland'}).json()
    b = client.post('/battles', json={'seed':512,'biome':'wetland'}).json()
    assert b['field'] == preview
    path = f'/battles/{b["id"]}'
    assert client.patch(path+'/strategy',json={'side':'cyan','unit_id':'amber-scout','prompt':'대기'}).status_code == 422
    r=client.patch(path+'/strategy',json={'side':'cyan','unit_id':'cyan-scout','prompt':'찰리 거점으로 이동'})
    assert r.status_code==200
    assert r.json()['unit_prompts']['cyan-scout']=='찰리 거점으로 이동'
    assert r.json()['prompts']['cyan']==b['prompts']['cyan']
    advanced=client.post(path+'/advance',json={'expected_round':0}).json()
    assert advanced['assignments']['cyan'][0]['objective']=='charlie'
    assert any(e['kind']=='task' and e['unit_id']=='cyan-scout' for e in advanced['frames'][1]['events'])
