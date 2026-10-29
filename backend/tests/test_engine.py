import asyncio
import math
from datetime import datetime, timezone

from backend.engine import SEPARATION, SPEED, observation, resolve, snapshot
from backend.models import Action, Battle, Obstacle, River, Terrain, Unit
from backend.orchestration import round_graph
from backend.store import Store


def open_field(obstacles=()):
    """Flat 5000 field, point-symmetric about the centre, with a token river in one corner."""
    return Terrain(seed=1, biome='woodland', name='TEST FIELD', heights=[], obstacles=list(obstacles),
                   river=River(points=[(0, 80), (80, 0)], width=20), bridges=[],
                   bases={'cyan': (500, 4500), 'amber': (4500, 500)},
                   beacons={'alpha': (1500, 1500), 'bravo': (2500, 2500), 'charlie': (3500, 3500)},
                   spawns={'cyan': [(700, 4300), (850, 4300), (1000, 4300)], 'amber': [(4300, 700), (4150, 700), (4000, 700)]})


def battle(units=None, field=None):
    field = field or open_field()
    b = Battle(id='a' * 32, created_at=datetime.now(timezone.utc).isoformat(), name='Test', mode='rehearsal', field=field,
               prompts={'cyan': '브라보 거점을 지켜', 'amber': '브라보 거점을 지켜'}, units=units or [
                   Unit(id=f'{s}-{r}', side=s, role=r, x=p[0], y=p[1])
                   for s in ('cyan', 'amber') for r, p in zip(('scout', 'vanguard', 'support'), field.spawns[s])])
    b.frames.append(snapshot(b))
    return b


def test_hidden_enemy_and_strategy_never_in_observation():
    b = battle()
    b.prompts['amber'] = 'TOP_SECRET_ENEMY_STRATEGY'
    obs = observation(b, 'cyan')
    assert all(u['side'] == 'cyan' for u in obs['visible_units'])
    assert 'TOP_SECRET' not in str(obs)
    assert len(obs['own_units']) == 3


def test_move_follows_path_and_is_capped_per_turn():
    b = battle([Unit(id='a', side='cyan', role='scout', x=1000, y=2500)])
    out = resolve(b, {'cyan': [Action(unit_id='a', kind='move', x=4000, y=2500)]})
    u = out.units[0]
    assert (u.x, u.y) == (1000 + SPEED, 2500)
    assert u.path[0] == (1000, 2500) and u.path[-1] == (u.x, u.y)
    assert u.goal == (4000, 2500)
    assert out.frames[-1].units[0].path == u.path


def test_same_point_collision_is_symmetric_and_input_is_immutable():
    b = battle([Unit(id='a', side='cyan', role='scout', x=2200, y=2500), Unit(id='b', side='amber', role='scout', x=2800, y=2500)])
    before = b.model_dump_json()
    out = resolve(b, {'cyan': [Action(unit_id='a', kind='move', x=2500, y=2500)],
                      'amber': [Action(unit_id='b', kind='move', x=2500, y=2500)]})
    a, c = out.units
    assert math.dist((a.x, a.y), (c.x, c.y)) >= SEPARATION
    assert 2500 - a.x == c.x - 2500
    assert b.model_dump_json() == before
    assert len([e for e in out.events if e.kind == 'blocked']) == 2


def test_allies_sharing_a_route_do_not_block_each_other():
    b = battle([Unit(id='cyan-vanguard', side='cyan', role='vanguard', x=1000, y=2500),
                Unit(id='cyan-support', side='cyan', role='support', x=1000, y=2600)])
    for _ in range(3):
        b = resolve(b, {'cyan': [Action(unit_id='cyan-vanguard', kind='move', x=3000, y=2550),
                                 Action(unit_id='cyan-support', kind='move', x=3000, y=2550)]})
    assert all(u.x > 2000 for u in b.units)


def test_both_robots_can_be_disabled_simultaneously():
    b = battle([Unit(id='a', side='cyan', role='vanguard', x=2300, y=2500, hp=2), Unit(id='b', side='amber', role='vanguard', x=2700, y=2500, hp=2)])
    out = resolve(b, {'cyan': [Action(unit_id='a', kind='pulse', target_id='b')], 'amber': [Action(unit_id='b', kind='pulse', target_id='a')]})
    assert [u.hp for u in out.units] == [0, 0]
    assert out.winner == 'draw'


def test_pulse_needs_range_and_line_of_sight():
    rock = Obstacle(kind='rock', x=2500, y=2500, r=80)
    b = battle([Unit(id='a', side='cyan', role='vanguard', x=2300, y=2500), Unit(id='b', side='amber', role='scout', x=2700, y=2500)],
               open_field([rock]))
    assert resolve(b, {'cyan': [Action(unit_id='a', kind='pulse', target_id='b')]}).units[1].hp == 5
    b.field.obstacles = []
    assert resolve(b, {'cyan': [Action(unit_id='a', kind='pulse', target_id='b')]}).units[1].hp == 3
    b.units[1].x = 2300 + 600
    assert resolve(b, {'cyan': [Action(unit_id='a', kind='pulse', target_id='b')]}).units[1].hp == 5


def test_opponent_control_off_map_and_duplicate_actions_rejected():
    b = battle()
    actions = [Action(unit_id='amber-scout', kind='move', x=3000, y=700),
               Action(unit_id='cyan-scout', kind='move', x=900, y=4000),
               Action(unit_id='cyan-scout', kind='move', x=600, y=4000),
               Action(unit_id='cyan-vanguard', kind='move', x=-50, y=4000)]
    out = resolve(b, {'cyan': actions})
    assert out.units[0].y < 4300
    assert (out.units[1].x, out.units[1].y) == (850, 4300)
    assert (out.units[3].x, out.units[3].y) == (4300, 700)
    assert len([e for e in out.events if e.kind == 'rejected']) == 3


def test_blocked_destination_snaps_to_open_ground():
    rock = Obstacle(kind='rock', x=2500, y=2500, r=150)
    b = battle([Unit(id='a', side='cyan', role='scout', x=2000, y=2500)], open_field([rock]))
    out = resolve(b, {'cyan': [Action(unit_id='a', kind='move', x=2500, y=2500)]})
    u = out.units[0]
    assert math.dist((u.x, u.y), (2500, 2500)) >= 150
    assert math.dist((u.x, u.y), (2000, 2500)) > 200


def test_repair_requires_support_role_and_range():
    b = battle([Unit(id='a', side='cyan', role='scout', x=1000, y=2000), Unit(id='c', side='cyan', role='support', x=1000, y=2200, hp=2),
                Unit(id='b', side='amber', role='scout', x=4000, y=2000)])
    assert resolve(b, {'cyan': [Action(unit_id='a', kind='repair', target_id='c')]}).units[1].hp == 2
    assert resolve(b, {'cyan': [Action(unit_id='c', kind='repair', target_id='c')]}).units[1].hp == 3
    b.units[0].hp = 3
    b.units[0].y = 2700
    assert resolve(b, {'cyan': [Action(unit_id='c', kind='repair', target_id='a')]}).units[0].hp == 3


def test_contested_beacon_scores_neither_side():
    b = battle([Unit(id='a', side='cyan', role='scout', x=2400, y=2500), Unit(id='b', side='amber', role='scout', x=2600, y=2500)])
    out = resolve(b, {})
    assert out.scores == {'cyan': 0, 'amber': 0}
    assert out.owners['bravo'] is None
    b.units[1].x = 3000
    out = resolve(b, {})
    assert out.owners['bravo'] == 'cyan' and out.scores['cyan'] == 1


def test_shield_and_pulse_damage_are_simultaneous():
    b = battle([Unit(id='a', side='cyan', role='vanguard', x=2300, y=2500), Unit(id='b', side='amber', role='vanguard', x=2700, y=2500)])
    out = resolve(b, {'cyan': [Action(unit_id='a', kind='pulse', target_id='b')], 'amber': [Action(unit_id='b', kind='shield')]})
    assert out.units[1].hp == 5


def test_graph_runs_complete_reproducible_match_and_store(tmp_path):
    async def play(b):
        while b.status != 'finished':
            b = (await round_graph.ainvoke({'battle': b}))['battle']
        return b
    initial = battle()
    first = asyncio.run(play(initial))
    second = asyncio.run(play(initial))
    assert first.model_dump() == second.model_dump()
    assert first.round == first.max_rounds == 30
    assert len(first.frames) == 31
    # Mirrored field and orders: the engine must not favour either side.
    assert first.winner == 'draw' and first.scores['cyan'] == first.scores['amber']
    pairs = zip(first.units[:3], first.units[3:])
    assert all(abs(c.x + a.x - 5000) < 1 and abs(c.y + a.y - 5000) < 1 and c.hp == a.hp for c, a in pairs)
    assert any(e.kind == 'pulse' for e in first.events)
    s = Store(tmp_path)
    s.save(first)
    assert s.get(first.id) == first
    assert s.list()[0]['winner'] == first.winner


def test_retired_grid_records_are_not_served(tmp_path):
    s = Store(tmp_path)
    with s.connect() as db:
        db.execute('INSERT INTO battles VALUES (?, ?, ?)', ('old', '2026-10-27', '{"id": "old", "field": {"size": 21, "cells": []}}'))
    assert s.get('old') is None
    assert s.list() == []
