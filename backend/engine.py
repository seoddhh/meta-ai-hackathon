"""Model-independent rules for a fictional, non-lethal robot field in continuous world units."""
import math

from .models import Action, Battle, Event, Frame, Point, Unit
from .navigation import UNIT_RADIUS, advance_along, nav, path_length, sight_clear

SPEED = 500
SENSOR = {'scout': 1000, 'vanguard': 700, 'support': 700}
SCAN_BONUS = 400
PULSE = {'scout': (350, 1), 'vanguard': (500, 2), 'support': (350, 1)}
REPAIR_RANGE = 400
CAPTURE_RADIUS = 250
SEPARATION = UNIT_RADIUS * 2
NEARBY_TERRAIN = 400
RULES = {
    'world': '5000x5000 continuous units; x grows east, y grows south',
    'move': f'move(x, y): walk up to {SPEED} units along an obstacle-avoiding path toward the point',
    'sensor': f'scout {SENSOR["scout"]}, others {SENSOR["vanguard"]}; scan adds {SCAN_BONUS} next turn',
    'pulse': f'vanguard range {PULSE["vanguard"][0]} damage 2, others range {PULSE["scout"][0]} damage 1; needs line of sight',
    'repair': f'support only, ally within {REPAIR_RANGE}, +1 energy',
    'shield': 'blocks 2 damage this round',
    'capture': f'only one side within {CAPTURE_RADIUS} of a beacon scores +1 that round',
    'terrain': 'forest and rock block movement and sight; water blocks movement, cross at bridges',
}


def distance(a: Unit | Point, b: Unit | Point) -> float:
    ax, ay = (a.x, a.y) if isinstance(a, Unit) else a
    bx, by = (b.x, b.y) if isinstance(b, Unit) else b
    return math.hypot(ax - bx, ay - by)


def line_of_sight(battle: Battle, a: Unit, b: Unit) -> bool:
    return sight_clear(battle.field, (a.x, a.y), (b.x, b.y))


def sensor_range(battle: Battle, unit: Unit) -> int:
    return SENSOR[unit.role] + (SCAN_BONUS if unit.scan_until > battle.round else 0)


def sees(battle: Battle, viewer: Unit, target: Unit) -> bool:
    return distance(viewer, target) <= sensor_range(battle, viewer) and line_of_sight(battle, viewer, target)


def plan_path(battle: Battle, unit: Unit, target: Point) -> list[Point] | None:
    """Obstacle-avoiding route from the unit toward target; the end is snapped to open ground."""
    return nav(battle.field).find_path((unit.x, unit.y), target)


def observation(battle: Battle, side: str) -> dict:
    field = battle.field
    own = [u for u in battle.units if u.side == side and u.hp > 0]
    visible = [u for u in battle.units if u.hp > 0 and (u.side == side or any(sees(battle, ally, u) for ally in own))]
    reach = max((sensor_range(battle, u) for u in own), default=0) + NEARBY_TERRAIN
    nearby = [o for o in field.obstacles if any(distance(u, (o.x, o.y)) <= reach + o.r for u in own)]
    return {'round': battle.round, 'scores': battle.scores.copy(), 'rules': RULES,
            'beacons': {k: {'x': round(v[0]), 'y': round(v[1]), 'owner': battle.owners[k]} for k, v in field.beacons.items()},
            'bases': {k: [round(v[0]), round(v[1])] for k, v in field.bases.items()},
            'terrain': {'seed': field.seed, 'biome': field.biome, 'size': field.size,
                        'bridges': [[round(b.x), round(b.y)] for b in field.bridges],
                        'nearby_obstacles': [{'kind': o.kind, 'x': round(o.x), 'y': round(o.y), 'r': round(o.r)} for o in nearby]},
            'visible_units': [u.model_dump(exclude={'path', 'goal'}) for u in visible],
            'available_tools': ['move', 'pulse', 'shield', 'repair (support only)', 'scan', 'hold'],
            'own_units': [dict(u.model_dump(exclude={'path', 'goal'}), sensor_range=sensor_range(battle, u),
                               pulse_range=PULSE[u.role][0], move_range=SPEED) for u in own]}


def snapshot(battle: Battle, events: list[Event] | None = None) -> Frame:
    return Frame(round=battle.round, units=[u.model_copy(deep=True) for u in battle.units],
                 scores=battle.scores.copy(), owners=battle.owners.copy(), events=events or [])


ROLE_ORDER = ('scout', 'vanguard', 'support')


def _separate(routes: dict[str, list[Point]], fixed: dict[str, Point], units: dict[str, Unit]) -> set[str]:
    """Back movers off along their own path until no two units overlap.

    Enemies that clash both yield, so neither side gains from processing order. Allies yield by
    role order instead, otherwise two teammates sharing a corridor would block each other forever.
    """
    stops = {uid: path_length(r) for uid, r in routes.items()}
    ends = {uid: r[-1] for uid, r in routes.items()}
    rank = lambda uid: (ROLE_ORDER.index(units[uid].role), uid)
    pulled: set[str] = set()
    for _ in range(40):
        points = {**fixed, **ends}
        clash = {uid for uid in routes for other, p in points.items()
                 if other != uid and math.dist(ends[uid], p) < SEPARATION
                 and (other not in routes or units[other].side != units[uid].side or rank(uid) > rank(other))}
        if not clash:
            break
        for uid in clash:
            stops[uid] = max(0.0, stops[uid] - CAPTURE_RADIUS / 5)
            ends[uid] = advance_along(routes[uid], stops[uid])[-1]
            pulled.add(uid)
    for uid in routes:
        routes[uid] = advance_along(routes[uid], stops[uid])
    return pulled


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

    for u in state.units:
        u.path, u.goal = [], None
    routes: dict[str, list[Point]] = {}
    for uid, action in actions.items():
        u = before[uid]
        if action.kind != 'move':
            continue
        if action.x is None or action.y is None or not (0 <= action.x <= state.field.size and 0 <= action.y <= state.field.size):
            record(u.side, 'rejected', f'{u.role}: 맵 밖 좌표, 현재 위치 유지', uid)
            continue
        route = plan_path(battle, u, (action.x, action.y))
        if not route or path_length(route) < 1:
            record(u.side, 'rejected', f'{u.role}: 도달 가능한 경로 없음, 현재 위치 유지', uid)
            continue
        units[uid].goal = (round(action.x, 1), round(action.y, 1))
        routes[uid] = advance_along(route, SPEED)
    fixed = {uid: (u.x, u.y) for uid, u in before.items() if uid not in routes}
    pulled = _separate(routes, fixed, before)
    for uid, route in routes.items():
        u = units[uid]
        u.path = [(round(x, 1), round(y, 1)) for x, y in route]
        u.x, u.y = u.path[-1]
        travelled = round(path_length(route))
        if uid in pulled:
            record(u.side, 'blocked', f'{u.role}: 다른 유닛과 겹쳐 {travelled}u만 이동', uid)
        else:
            record(u.side, 'move', f'{u.role} → {round(u.x)},{round(u.y)} ({travelled}u)', uid)

    # Shields are refreshed only by a shield action; pulses resolve at post-move positions.
    for uid, u in units.items():
        u.shield = 2 if uid in actions and actions[uid].kind == 'shield' else 0
    damage = {uid: 0 for uid in units}
    healing = {uid: 0 for uid in units}
    for uid, action in actions.items():
        u = units[uid]
        target = units.get(action.target_id or '')
        if action.kind == 'pulse':
            # No blind targeting: the target must have been in the actor's own sensor before moving.
            reach, power = PULSE[u.role]
            valid = target and target.side != u.side and sees(battle, before[uid], before[target.id])
            if valid and distance(u, target) <= reach and line_of_sight(state, u, target):
                damage[target.id] += power
                record(u.side, 'pulse', f'{u.role} → {target.role}: 에너지 펄스', uid)
            else:
                record(u.side, 'rejected', f'{u.role}: 대상이 사거리 또는 시야 밖', uid)
        elif action.kind == 'repair':
            if u.role == 'support' and target and target.side == u.side and distance(u, target) <= REPAIR_RANGE:
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

    for name, point in state.field.beacons.items():
        nearby = {u.side for u in units.values() if u.hp > 0 and distance(u, point) <= CAPTURE_RADIUS}
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
