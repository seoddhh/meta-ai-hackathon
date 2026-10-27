from datetime import datetime, timezone

import pytest

from backend.engine import observation, resolve, snapshot
from backend.models import Action, Battle, Unit
from backend.orchestration import round_graph
from backend.store import Store


def battle(units=None):
    b = Battle(id='a' * 32, created_at=datetime.now(timezone.utc).isoformat(), name='Test', mode='rehearsal',
               prompts={'cyan': '북쪽 거점을 지켜', 'amber': '남쪽 거점을 지켜'}, units=units or [
                   Unit(id=f'{s}-{r}', side=s, role=r, x=x, y=y if s == 'cyan' else 10-y)
                   for s, x in [('cyan', 1), ('amber', 9)]
                   for r, y in [('scout', 2), ('vanguard', 5), ('support', 8)]])
    b.frames.append(snapshot(b))
    return b


def test_hidden_enemy_and_strategy_never_in_observation():
    b = battle()
    b.prompts['amber'] = 'TOP_SECRET_ENEMY_STRATEGY'
    obs = observation(b, 'cyan')
    assert all(u['side'] == 'cyan' for u in obs['visible_units'])
    assert 'TOP_SECRET' not in str(obs)
    assert len(obs['own_units']) == 3


def test_same_cell_collision_is_symmetric_and_input_is_immutable():
    b = battle([Unit(id='a', side='cyan', role='scout', x=4, y=5), Unit(id='b', side='amber', role='scout', x=6, y=5)])
    before = b.model_dump_json()
    out = resolve(b, {'cyan': [Action(unit_id='a', kind='move', x=5, y=5)], 'amber': [Action(unit_id='b', kind='move', x=5, y=5)]})
    assert [(u.x, u.y) for u in out.units] == [(4, 5), (6, 5)]
    assert b.model_dump_json() == before
    assert len([e for e in out.events if e.kind == 'blocked']) == 2


def test_both_robots_can_be_disabled_simultaneously():
    b = battle([Unit(id='a', side='cyan', role='vanguard', x=4, y=5, hp=2), Unit(id='b', side='amber', role='vanguard', x=6, y=5, hp=2)])
    out = resolve(b, {'cyan': [Action(unit_id='a', kind='pulse', target_id='b')], 'amber': [Action(unit_id='b', kind='pulse', target_id='a')]})
    assert [u.hp for u in out.units] == [0, 0]
    assert out.winner == 'draw'


def test_opponent_control_teleport_and_duplicate_actions_rejected():
    b = battle()
    actions = [Action(unit_id='amber-scout', kind='move', x=8, y=2),
               Action(unit_id='cyan-scout', kind='move', x=5, y=2),
               Action(unit_id='cyan-scout', kind='move', x=2, y=2)]
    out = resolve(b, {'cyan': actions})
    assert out.units[0].x == 1
    assert out.units[3].x == 9
    assert len([e for e in out.events if e.kind == 'rejected']) == 3


def test_wall_and_occupied_moves_rejected():
    b = battle([Unit(id='a', side='cyan', role='scout', x=2, y=3), Unit(id='b', side='amber', role='scout', x=1, y=3)])
    out = resolve(b, {'cyan': [Action(unit_id='a', kind='move', x=3, y=3)]})
    assert out.units[0].x == 2
    out = resolve(b, {'cyan': [Action(unit_id='a', kind='move', x=1, y=3)]})
    assert out.units[0].x == 2


def test_repair_requires_support_role():
    b = battle([Unit(id='a', side='cyan', role='scout', x=1, y=2), Unit(id='c', side='cyan', role='support', x=1, y=3, hp=2),
                Unit(id='b', side='amber', role='scout', x=9, y=2)])
    out = resolve(b, {'cyan': [Action(unit_id='a', kind='repair', target_id='c')]})
    assert out.units[1].hp == 2
    out = resolve(b, {'cyan': [Action(unit_id='c', kind='repair', target_id='c')]})
    assert out.units[1].hp == 3


def test_contested_beacon_scores_neither_side():
    b = battle([Unit(id='a', side='cyan', role='scout', x=4, y=5), Unit(id='b', side='amber', role='scout', x=6, y=5)])
    out = resolve(b, {})
    assert out.scores == {'cyan': 0, 'amber': 0}
    assert out.owners['center'] is None


def test_shield_and_pulse_damage_are_simultaneous():
    b = battle([Unit(id='a', side='cyan', role='vanguard', x=4, y=5), Unit(id='b', side='amber', role='vanguard', x=6, y=5)])
    out = resolve(b, {'cyan': [Action(unit_id='a', kind='pulse', target_id='b')], 'amber': [Action(unit_id='b', kind='shield')]})
    assert out.units[1].hp == 5


def test_graph_runs_complete_reproducible_match_and_store(tmp_path):
    import asyncio
    async def play(b):
        for _ in range(12):
            if b.status == 'finished': break
            b = (await round_graph.ainvoke({'battle': b}))['battle']
        return b
    initial = battle()
    first = asyncio.run(play(initial))
    second = asyncio.run(play(initial))
    assert first.model_dump() == second.model_dump()
    assert first.status == 'finished'
    assert first.round == 12
    assert len(first.frames) == 13
    assert first.scores['cyan'] > 0
    assert first.scores['cyan'] == first.scores['amber']
    assert first.winner == 'draw'
    s = Store(tmp_path)
    s.save(first)
    assert s.get(first.id) == first
    assert s.list()[0]['winner'] == first.winner
