from collections import deque

import pytest

from backend.engine import legal_moves, line_of_sight, observation, resolve, snapshot, walkable
from backend.models import Action, Battle, Unit
from backend.orchestration import round_graph
from backend.terrain import generate


def make_battle(field, units):
    return Battle(id='e'*32, created_at='2026-10-27', name=field.name, mode='rehearsal', field=field,
                  prompts={'cyan':'북쪽 거점을 확보해','amber':'남쪽 거점을 확보해'}, units=units)


@pytest.mark.parametrize('biome', ['woodland','highland','wetland'])
def test_seed_reproducibility_and_connected_objectives(biome):
    for seed in range(40):
        f = generate(seed, biome)
        assert f == generate(seed, biome)
        assert f != generate(seed+1, biome)
        b = make_battle(f, [])
        start = f.spawns['cyan'][0]
        seen, queue = {start}, deque([start])
        while queue:
            x,y = queue.popleft()
            for p in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if p not in seen and walkable(*p, b):
                    seen.add(p)
                    queue.append(p)
        assert set(f.beacons.values()) <= seen
        assert all(p in seen for spawns in f.spawns.values() for p in spawns)
        assert any(c.kind == 'water' and c.blocked for c in f.cells)
        assert any(c.kind == 'bridge' and not c.blocked for c in f.cells)


def test_terrain_obstacles_block_movement_and_sight():
    f = generate(44)
    a = Unit(id='cyan-scout',side='cyan',role='scout',x=3,y=4)
    enemy = Unit(id='amber-vanguard',side='amber',role='vanguard',x=5,y=4)
    b = make_battle(f, [a,enemy])
    wall = f.cells[4*f.size+4]
    wall.kind, wall.blocked = 'forest', True
    assert not line_of_sight(b,a,enemy)
    assert not any(u['side']=='amber' for u in observation(b,'cyan')['visible_units'])
    assert (4,4) not in legal_moves(b,a)
    moved = resolve(b,{'cyan':[Action(unit_id=a.id,kind='move',x=4,y=4)]})
    assert moved.units[0].x == 3
    pulsed = resolve(b,{'cyan':[Action(unit_id=a.id,kind='pulse',target_id=enemy.id)]})
    assert pulsed.units[1].hp == 5
    wall.kind, wall.blocked = 'bridge', False
    assert line_of_sight(b,a,enemy)
    assert (4,4) in legal_moves(b,a)


def test_scan_extends_next_turn_observation_only():
    f=generate(44)
    a=Unit(id='cyan-support',side='cyan',role='support',x=3,y=4)
    e=Unit(id='amber-scout',side='amber',role='scout',x=8,y=4)
    b=make_battle(f,[a,e])
    assert len(observation(b,'cyan')['visible_units'])==1
    b=resolve(b,{'cyan':[Action(unit_id=a.id,kind='scan')]})
    assert len(observation(b,'cyan')['visible_units'])==2
    b=resolve(b,{})
    assert len(observation(b,'cyan')['visible_units'])==1


def test_direct_order_reaches_commander_worker_and_tool_log():
    import asyncio
    f=generate(44)
    a=Unit(id='cyan-scout',side='cyan',role='scout',x=2,y=4)
    e=Unit(id='amber-scout',side='amber',role='scout',x=18,y=16)
    b=make_battle(f,[a,e])
    b.unit_prompts[a.id]='남쪽 거점, 현재 위치에서 대기'
    b.unit_prompts[e.id]='ENEMY_SECRET_ORDER'
    result=asyncio.run(round_graph.ainvoke({'battle':b}))['battle']
    assert result.assignments['cyan'][0].objective=='south'
    assert result.units[0].x==2 and result.units[0].y==4
    assert any(ev.kind=='tool' and ev.unit_id==a.id and ev.message=='hold(self)' for ev in result.events)
    assert 'ENEMY_SECRET_ORDER' not in str(observation(b,'cyan'))
    assert any(ev.kind=='task' and ev.unit_id==a.id for ev in result.frames[-1].events)
