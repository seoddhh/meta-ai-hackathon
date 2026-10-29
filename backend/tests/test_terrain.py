import asyncio
import math

import pytest

from backend.engine import observation, resolve
from backend.models import Action, Battle, Obstacle, Unit
from backend.navigation import nav, on_bridge, polyline_distance, segment_distance
from backend.orchestration import round_graph
from backend.terrain import generate


def make_battle(field, units):
    return Battle(id='e'*32, created_at='2026-10-29', name=field.name, mode='rehearsal', field=field,
                  prompts={'cyan':'알파 거점을 확보해','amber':'찰리 거점을 확보해'}, units=units)


@pytest.mark.parametrize('biome', ['woodland','highland','wetland'])
def test_seed_reproducibility_connectivity_and_fair_beacons(biome):
    for seed in range(0, 80, 10):
        f = generate(seed, biome)
        assert f == generate(seed, biome)
        assert f != generate(seed+1, biome)
        assert f.size == 5000 and set(f.beacons) == {'alpha','bravo','charlie'} and f.bridges
        grid = nav(f)
        dc, da = grid.distances(f.bases['cyan']), grid.distances(f.bases['amber'])
        for p in [*f.beacons.values(), *f.spawns['cyan'], *f.spawns['amber']]:
            assert grid.walkable(p)
            i, j = grid.cell_of(p)
            c, a = dc[j*grid.n+i], da[j*grid.n+i]
            assert math.isfinite(c) and math.isfinite(a)
        for p in f.beacons.values():
            i, j = grid.cell_of(p)
            c, a = dc[j*grid.n+i], da[j*grid.n+i]
            assert abs(c-a)/(c+a) <= .08
        beacons = list(f.beacons.values())
        assert all(math.dist(p, q) > 1200 for k, p in enumerate(beacons) for q in beacons[k+1:])


def test_forest_blocks_movement_and_sight():
    f = generate(44)
    a = Unit(id='cyan-scout', side='cyan', role='scout', x=2500, y=2500)
    enemy = Unit(id='amber-vanguard', side='amber', role='vanguard', x=2900, y=2500)
    f.obstacles = [o for o in f.obstacles if math.dist((o.x, o.y), (2700, 2500)) > o.r + 400]
    f.river.points = [(0.0, 60.0), (60.0, 0.0)]
    f.bridges = []
    b = make_battle(f, [a, enemy])
    assert any(u['side'] == 'amber' for u in observation(b, 'cyan')['visible_units'])
    f.obstacles.append(Obstacle(kind='forest', x=2700, y=2500, r=120))
    assert not any(u['side'] == 'amber' for u in observation(b, 'cyan')['visible_units'])
    pulsed = resolve(b, {'cyan': [Action(unit_id=enemy.id, kind='pulse', target_id=a.id)],
                         'amber': [Action(unit_id=enemy.id, kind='pulse', target_id=a.id)]})
    assert pulsed.units[0].hp == 5
    # Asking to walk through the grove produces a detour that never enters it.
    moved = resolve(b, {'cyan': [Action(unit_id=a.id, kind='move', x=2700, y=2500)]})
    walker = moved.units[0]
    assert math.dist((walker.x, walker.y), (2700, 2500)) > 120
    assert all(segment_distance((2700, 2500), p, q) >= 120 for p, q in zip(walker.path, walker.path[1:]))
    # Water does not block sight.
    f.obstacles[-1] = Obstacle(kind='water', x=2700, y=2500, r=120)
    assert any(u['side'] == 'amber' for u in observation(b, 'cyan')['visible_units'])


def test_river_is_crossed_only_on_bridges():
    f = generate(73184)
    route = nav(f).find_path(f.bases['cyan'], f.bases['amber'])
    samples = [(p[0]+(q[0]-p[0])*k/40, p[1]+(q[1]-p[1])*k/40) for p, q in zip(route, route[1:]) for k in range(41)]
    wet = [m for m in samples if polyline_distance(m, f.river.points) < f.river.width/2]
    assert wet  # the bases sit on opposite banks
    assert all(any(on_bridge(m, br) for br in f.bridges) for m in wet)


def test_scan_extends_next_turn_observation_only():
    f = generate(44)
    f.obstacles = [o for o in f.obstacles if math.dist((o.x, o.y), (2600, 2500)) > o.r + 700]
    a = Unit(id='cyan-support', side='cyan', role='support', x=2300, y=2500)
    e = Unit(id='amber-scout', side='amber', role='scout', x=2300+900, y=2500)
    b = make_battle(f, [a, e])
    assert len(observation(b, 'cyan')['visible_units']) == 1
    b = resolve(b, {'cyan': [Action(unit_id=a.id, kind='scan')]})
    assert len(observation(b, 'cyan')['visible_units']) == 2
    b = resolve(b, {})
    assert len(observation(b, 'cyan')['visible_units']) == 1


def test_direct_order_reaches_commander_worker_and_tool_log():
    f = generate(44)
    a = Unit(id='cyan-scout', side='cyan', role='scout', x=f.spawns['cyan'][0][0], y=f.spawns['cyan'][0][1])
    e = Unit(id='amber-scout', side='amber', role='scout', x=f.spawns['amber'][0][0], y=f.spawns['amber'][0][1])
    b = make_battle(f, [a, e])
    b.unit_prompts[a.id] = '찰리 거점, 현재 위치에서 대기'
    b.unit_prompts[e.id] = 'ENEMY_SECRET_ORDER'
    result = asyncio.run(round_graph.ainvoke({'battle': b}))['battle']
    assert result.assignments['cyan'][0].objective == 'charlie'
    assert (result.units[0].x, result.units[0].y) == (a.x, a.y)
    assert any(ev.kind == 'tool' and ev.unit_id == a.id and ev.message == 'hold(self)' for ev in result.events)
    assert 'ENEMY_SECRET_ORDER' not in str(observation(b, 'cyan'))
    assert any(ev.kind == 'task' and ev.unit_id == a.id for ev in result.frames[-1].events)
