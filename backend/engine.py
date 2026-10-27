"""Model-independent rules for a fictional, non-lethal robot arena."""
from collections import deque

from .models import Action, Battle, Event, Frame, Unit

SIZE = 11
BEACONS = {'north': (5, 2), 'center': (5, 5), 'south': (5, 8)}
WALLS = {(3, 3), (3, 4), (3, 6), (3, 7), (7, 3), (7, 4), (7, 6), (7, 7), (5, 0), (5, 10)}


def distance(a: Unit, b: Unit) -> int:
    return abs(a.x - b.x) + abs(a.y - b.y)


def beacons(battle: Battle) -> dict[str, tuple[int, int]]:
    return battle.field.beacons if battle.field else BEACONS


def walkable(x: int, y: int, battle: Battle | None = None) -> bool:
    if battle and battle.field:
        field = battle.field
        return 0 <= x < field.size and 0 <= y < field.size and not field.cells[y * field.size + x].blocked
    return 0 <= x < SIZE and 0 <= y < SIZE and (x, y) not in WALLS


def line_of_sight(battle: Battle, a: Unit, b: Unit) -> bool:
    if not battle.field:
        return True  # Preserve the original arena replay rules.
    dx, dy = b.x - a.x, b.y - a.y
    steps = max(abs(dx), abs(dy))
    for i in range(1, steps):
        x, y = round(a.x + dx * i / steps), round(a.y + dy * i / steps)
        if battle.field.cells[y * battle.field.size + x].kind in ('forest', 'rock'):
            return False
    return True


def sensor_range(battle: Battle, unit: Unit) -> int:
    return (5 if unit.role == 'scout' else 3) + (3 if unit.scan_until > battle.round else 0)


def legal_moves(battle: Battle, unit: Unit) -> list[tuple[int, int]]:
    occupied = {(u.x, u.y) for u in battle.units if u.hp > 0}
    return [(x, y) for x, y in [(unit.x, unit.y - 1), (unit.x + 1, unit.y),
                              (unit.x, unit.y + 1), (unit.x - 1, unit.y)]
            if walkable(x, y, battle) and (x, y) not in occupied]


def observation(battle: Battle, side: str) -> dict:
    own = [u for u in battle.units if u.side == side and u.hp > 0]
    visible = [u for u in battle.units if u.hp > 0 and (u.side == side or any(
        distance(u, ally) <= sensor_range(battle, ally) and line_of_sight(battle, ally, u) for ally in own))]
    return {'round': battle.round, 'scores': battle.scores.copy(),
            'beacons': {k: {'x': v[0], 'y': v[1], 'owner': battle.owners[k]} for k, v in beacons(battle).items()},
            'terrain': {'seed': battle.field.seed, 'biome': battle.field.biome, 'size': battle.field.size} if battle.field else None,
            'walls': [(c.x, c.y) for c in battle.field.cells if c.blocked] if battle.field else sorted(WALLS),
            'visible_units': [u.model_dump() for u in visible],
            'available_tools': ['move', 'pulse', 'shield', 'repair (support only)', 'scan', 'hold'],
            'own_units': [dict(u.model_dump(), legal_moves=legal_moves(battle, u)) for u in own]}


def step_toward(battle: Battle, unit: Unit, target: tuple[int, int]) -> tuple[int, int] | None:
    """BFS avoids obstacles without inventing diagonal or multi-cell moves."""
    occupied = {(u.x, u.y) for u in battle.units if u.hp > 0 and u.id != unit.id}
    start = (unit.x, unit.y)
    queue = deque([(start, None)])
    seen = {start}
    best = (abs(start[0] - target[0]) + abs(start[1] - target[1]), None)
    while queue:
        (x, y), first = queue.popleft()
        d = abs(x - target[0]) + abs(y - target[1])
        if d < best[0]:
            best = (d, first)
        if (x, y) == target:
            return first
        for point in [(x, y - 1), (x + 1, y), (x, y + 1), (x - 1, y)]:
            if point not in seen and point not in occupied and walkable(*point, battle):
                seen.add(point)
                queue.append((point, first or point))
    return best[1]


def snapshot(battle: Battle, events: list[Event] | None = None) -> Frame:
    return Frame(round=battle.round, units=[u.model_copy(deep=True) for u in battle.units],
                 scores=battle.scores.copy(), owners=battle.owners.copy(), events=events or [])


def resolve(battle: Battle, proposed: dict[str, list[Action]]) -> Battle:
    """Both teams act on the same immutable pre-turn state; damage is simultaneous."""
    state = battle.model_copy(deep=True)
    units = {u.id: u for u in state.units if u.hp > 0}
    before = {u.id: u.model_copy(deep=True) for u in battle.units if u.hp > 0}
    turn = battle.round + 1
    events: list[Event] = []
    actions: dict[str, Action] = {}

    def record(side: str, kind: str, message: str, uid: str | None = None):
        events.append(Event(round=turn, side=side, kind=kind, message=message, unit_id=uid))

    # Validate against the sending side and allow at most one action per own unit.
    for side in ('cyan', 'amber'):
        for action in proposed.get(side, []):
            actor = before.get(action.unit_id)
            if not actor or actor.side != side or action.unit_id in actions:
                record(side, 'rejected', '소유권 또는 중복 행동 검증 실패')
                continue
            actions[action.unit_id] = action

    destinations: dict[str, tuple[int, int]] = {}
    for uid, action in actions.items():
        u = before[uid]
        if action.kind == 'move':
            if (action.x, action.y) in legal_moves(battle, u):
                destinations[uid] = (action.x, action.y)
            else:
                record(u.side, 'rejected', f'{u.role}: 이동 불가, 현재 위치 유지', uid)
    for uid, point in destinations.items():
        u = units[uid]
        if list(destinations.values()).count(point) == 1:
            u.x, u.y = point
            record(u.side, 'move', f'{u.role} → {point[0]},{point[1]}', uid)
        else:
            record(u.side, 'blocked', f'{u.role}: 경로 충돌로 대기', uid)

    # Shields are refreshed only by a shield action; pulses resolve at post-move positions.
    for uid, u in units.items():
        u.shield = 2 if uid in actions and actions[uid].kind == 'shield' else 0
    damage = {uid: 0 for uid in units}
    healing = {uid: 0 for uid in units}
    for uid, action in actions.items():
        u = units[uid]
        target = units.get(action.target_id or '')
        if action.kind == 'pulse':
            # No blind targeting: the target must have been in the actor's own sensor range.
            seen_range = sensor_range(battle, before[uid])
            valid = target and target.side != u.side and distance(before[uid], before[target.id]) <= seen_range and line_of_sight(battle, before[uid], before[target.id])
            if valid and distance(u, target) <= (3 if u.role == 'vanguard' else 2) and line_of_sight(state, u, target):
                damage[target.id] += 2 if u.role == 'vanguard' else 1
                record(u.side, 'pulse', f'{u.role} → {target.role}: 에너지 펄스', uid)
            else:
                record(u.side, 'rejected', f'{u.role}: 대상이 사거리 또는 시야 밖', uid)
        elif action.kind == 'repair':
            if u.role == 'support' and target and target.side == u.side and distance(u, target) <= 2:
                healing[target.id] += 1
                record(u.side, 'repair', f'support → {target.role}: 에너지 복구', uid)
            else:
                record(u.side, 'rejected', f'{u.role}: 복구 조건 불충족', uid)
        elif action.kind == 'shield':
            record(u.side, 'shield', f'{u.role}: 보호막 전개', uid)
        elif action.kind in ('scan', 'hold'):
            if action.kind == 'scan':
                u.scan_until = turn + 1
            record(u.side, action.kind, f'{u.role}: {"센서 확인" if action.kind == "scan" else "위치 유지"}', uid)
    for uid, u in units.items():
        u.hp = max(0, min(5, u.hp + healing[uid] - max(0, damage[uid] - u.shield)))
        if u.hp == 0:
            record(u.side, 'disabled', f'{u.role}: 경기장 유닛 비활성화', uid)

    for name, (x, y) in beacons(state).items():
        nearby = {u.side for u in units.values() if u.hp > 0 and abs(u.x - x) + abs(u.y - y) <= 1}
        owner = next(iter(nearby)) if len(nearby) == 1 else None
        state.owners[name] = owner
        if owner:
            state.scores[owner] += 1
            record(owner, 'capture', f'{name.upper()} 신호 거점 +1')
    state.round = turn
    state.status = 'playing'
    alive = {u.side for u in units.values() if u.hp > 0}
    if turn >= state.max_rounds or len(alive) < 2:
        state.status = 'finished'
        ranks = {side: (int(side in alive), state.scores[side], sum(u.hp for u in units.values() if u.side == side))
                 for side in ('cyan', 'amber')}
        state.winner = 'draw' if ranks['cyan'] == ranks['amber'] else max(ranks, key=ranks.get)
        record(state.winner, 'result', f'경기 종료 · {state.winner.upper()}')
    state.events.extend(events)
    state.frames.append(snapshot(state, [e for e in state.events if e.round == turn]))
    return state
