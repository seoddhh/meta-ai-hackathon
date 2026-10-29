"""Seeded free-form 5000x5000 battlefield: bases, river, groves, rocks and fair signal beacons.

Layout is asymmetric. Fairness comes from beacon placement: every beacon's walking distance
from the two bases differs by a small ratio, measured on the same nav grid the engine uses.
"""
import math
import random

from .models import Bridge, Obstacle, Point, River, Terrain
from .navigation import CELL, UNIT_RADIUS, NavGrid, polyline_distance, segment_distance

SIZE = 5000
HEIGHT_STEPS = 100
BASE_CLEAR = 550
BEACON_CLEAR = 220
NAMES = {'woodland': 'WHISPERING PINES', 'highland': 'GRANITE PASS', 'wetland': 'MISTWATER BASIN'}
BEACON_NAMES = ('alpha', 'bravo', 'charlie')
# (groves, rocks, ridges, lakes, river width, bridges, relief)
BIOMES = {
    'woodland': ((30, 38), (16, 24), (0, 1), (0, 2), (190, 240), (3, 4), 70),
    'highland': ((14, 20), (24, 34), (4, 6), (0, 1), (140, 180), (2, 3), 170),
    'wetland': ((20, 27), (10, 16), (0, 0), (4, 6), (270, 340), (3, 5), 40),
}


def _river(rng: random.Random, width: float) -> River:
    """Meanders from the north-west region to the south-east region, splitting the two bases."""
    start = (rng.uniform(300, 1900), 0.0) if rng.random() < .5 else (0.0, rng.uniform(300, 1900))
    end = (rng.uniform(3100, 4700), float(SIZE)) if rng.random() < .5 else (float(SIZE), rng.uniform(3100, 4700))
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    nx, ny = -dy / length, dx / length
    waves = [(rng.uniform(.8, 2.6), rng.uniform(0, math.tau), rng.uniform(120, 340)) for _ in range(2)]
    points = []
    for k in range(29):
        t = k / 28
        # Taper the meander at the edges so the river leaves the map where it entered.
        bend = sum(a * math.sin(f * math.tau * t + p) for f, p, a in waves) * math.sin(math.pi * t)
        points.append((round(start[0] + dx * t + nx * bend, 1), round(start[1] + dy * t + ny * bend, 1)))
    return River(points=points, width=round(width, 1))


def _bridges(rng: random.Random, river: River, count: int) -> list[Bridge]:
    pts = river.points
    # One crossing always sits near the map centre so the middle of the field stays contestable.
    middle = min(range(len(pts)), key=lambda k: math.hypot(pts[k][0] - SIZE / 2, pts[k][1] - SIZE / 2))
    chosen = [max(5, min(len(pts) - 6, middle + rng.randint(-2, 2)))]
    # Keep crossings apart so each one is a distinct route.
    for s in rng.sample(range(5, len(pts) - 5), len(pts) - 10):
        if len(chosen) < count and all(abs(s - c) >= 5 for c in chosen):
            chosen.append(s)
    out = []
    for s in sorted(chosen):
        a, b = pts[s - 1], pts[s + 1]
        angle = math.atan2(b[1] - a[1], b[0] - a[0]) + math.pi / 2
        out.append(Bridge(x=pts[s][0], y=pts[s][1], angle=round(angle, 4), length=round(river.width + 180, 1), width=220))
    return out


def _scatter(rng, count, radius, keep_out, kind) -> list[Obstacle]:
    out = []
    tries = 0
    while len(out) < count and tries < count * 30:
        tries += 1
        r = rng.uniform(*radius)
        x, y = rng.uniform(150, SIZE - 150), rng.uniform(150, SIZE - 150)
        if keep_out((x, y), r):
            out.append(Obstacle(kind=kind, x=round(x, 1), y=round(y, 1), r=round(r, 1)))
    return out


def _heights(rng, biome, relief, river, obstacles) -> list[list[float]]:
    lattice = [[rng.random() for _ in range(10)] for _ in range(10)]
    detail = [[rng.random() for _ in range(26)] for _ in range(26)]
    lakes = [o for o in obstacles if o.kind == 'water']
    rocks = [o for o in obstacles if o.kind == 'rock']

    def noise(table, x, y, span):
        x, y = x / span, y / span
        ix, iy = int(x), int(y)
        tx, ty = x - ix, y - iy
        tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        return ((table[iy][ix] * (1 - tx) + table[iy][ix + 1] * tx) * (1 - ty)
                + (table[iy + 1][ix] * (1 - tx) + table[iy + 1][ix + 1] * tx) * ty)

    step = SIZE / HEIGHT_STEPS
    rows = []
    for j in range(HEIGHT_STEPS + 1):
        row = []
        for i in range(HEIGHT_STEPS + 1):
            p = (i * step, j * step)
            h = 12 + noise(lattice, *p, 560) * relief + noise(detail, *p, 210) * relief * .25
            water = min([polyline_distance(p, river.points) - river.width / 2]
                        + [math.hypot(p[0] - o.x, p[1] - o.y) - o.r for o in lakes])
            if water < 0:
                h = -45.0
            else:
                h *= min(1.0, water / 380)
            if biome == 'highland':
                h += sum(max(0.0, 1 - math.hypot(p[0] - o.x, p[1] - o.y) / (o.r * 1.6)) * 55 for o in rocks
                         if abs(p[0] - o.x) < o.r * 1.6 and abs(p[1] - o.y) < o.r * 1.6)
            row.append(round(h, 1))
        rows.append(row)
    return rows


class LayoutRejected(Exception):
    pass


def generate(seed: int, biome: str = 'woodland') -> Terrain:
    """Same seed and biome always give the same field; rejected layouts re-roll from the same stream."""
    rng = random.Random(seed)
    for _ in range(12):
        try:
            return _layout(rng, seed, biome)
        except LayoutRejected:
            continue
    raise RuntimeError(f'no fair layout for seed {seed}')


def _layout(rng: random.Random, seed: int, biome: str) -> Terrain:
    groves, rocks, ridges, lakes, width, bridge_count, relief = BIOMES[biome]
    j = lambda: rng.uniform(380, 640)
    bases = {'cyan': (round(j(), 1), round(SIZE - j(), 1)), 'amber': (round(SIZE - j(), 1), round(j(), 1))}
    river = _river(rng, rng.uniform(*width))
    bridges = _bridges(rng, river, rng.randint(*bridge_count))

    def clear_of_layout(p: Point, r: float, water_gap: float = 70) -> bool:
        return (all(math.hypot(p[0] - b[0], p[1] - b[1]) > BASE_CLEAR + r for b in bases.values())
                and polyline_distance(p, river.points) > river.width / 2 + r + water_gap
                and all(math.hypot(p[0] - b.x, p[1] - b.y) > b.length / 2 + r + 200 for b in bridges))

    obstacles = _scatter(rng, rng.randint(*lakes), (150, 340), lambda p, r: clear_of_layout(p, r, 260), 'water')
    lake_free = lambda p, r: all(math.hypot(p[0] - o.x, p[1] - o.y) > o.r + r + 60 for o in obstacles if o.kind == 'water')
    # Groves are clusters of overlapping circles so forests read as organic shapes, not dots.
    for core in _scatter(rng, rng.randint(*groves), (110, 240), lambda p, r: clear_of_layout(p, r) and lake_free(p, r), 'forest'):
        obstacles.append(core)
        for _ in range(rng.randint(1, 3)):
            a, d = rng.uniform(0, math.tau), core.r * rng.uniform(.6, 1.1)
            p, r = (core.x + math.cos(a) * d, core.y + math.sin(a) * d), core.r * rng.uniform(.4, .7)
            if 120 < p[0] < SIZE - 120 and 120 < p[1] < SIZE - 120 and clear_of_layout(p, r) and lake_free(p, r):
                obstacles.append(Obstacle(kind='forest', x=round(p[0], 1), y=round(p[1], 1), r=round(r, 1)))
    obstacles += _scatter(rng, rng.randint(*rocks), (55, 150), lambda p, r: clear_of_layout(p, r) and lake_free(p, r), 'rock')
    for _ in range(rng.randint(*ridges)):
        x, y, a = rng.uniform(600, SIZE - 600), rng.uniform(600, SIZE - 600), rng.uniform(0, math.tau)
        for k in range(rng.randint(5, 9)):
            p, r = (x + math.cos(a) * k * 150, y + math.sin(a) * k * 150), rng.uniform(80, 150)
            a += rng.uniform(-.35, .35)
            if 150 < p[0] < SIZE - 150 and 150 < p[1] < SIZE - 150 and clear_of_layout(p, r) and lake_free(p, r):
                obstacles.append(Obstacle(kind='rock', x=round(p[0], 1), y=round(p[1], 1), r=round(r, 1)))

    field = Terrain(seed=seed, biome=biome, name=NAMES[biome], heights=[], obstacles=obstacles, river=river,
                    bridges=bridges, bases=bases, beacons={}, spawns={})
    _carve_route(field, bases['cyan'], bases['amber'])
    grid = NavGrid(field)
    field.beacons = _place_beacons(field, grid)
    field.spawns = {side: _spawns(field, side) for side in ('cyan', 'amber')}
    field.heights = _heights(rng, biome, relief, river, field.obstacles)
    return field


def _carve_route(field: Terrain, a: Point, b: Point):
    """Guarantee base-to-base connectivity by removing soft obstacles along the shortest water-respecting route."""
    if NavGrid(field).find_path(a, b):
        return
    water_only = field.model_copy(update={'obstacles': [o for o in field.obstacles if o.kind == 'water']})
    route = NavGrid(water_only).find_path(a, b)
    if not route:
        field.obstacles = [o for o in field.obstacles if o.kind != 'water']
        route = NavGrid(field.model_copy(update={'obstacles': []})).find_path(a, b) or [a, b]
    margin = UNIT_RADIUS + CELL * 1.5
    field.obstacles = [o for o in field.obstacles if o.kind == 'water' or all(
        segment_distance((o.x, o.y), p, q) > o.r + margin for p, q in zip(route, route[1:]))]


def _clearance(grid: NavGrid, p: Point, radius: float) -> bool:
    """Enough open ground around a beacon to contest it; a riverbank or bridge edge is fine."""
    cells = [grid.open(i, jj) for i, jj in grid._cells_in_box(p[0] - radius, p[1] - radius, p[0] + radius, p[1] + radius)
             if math.dist(grid.center(i, jj), p) <= radius]
    return grid.open(*grid.cell_of(p)) and sum(cells) >= len(cells) * .6


def _place_beacons(field: Terrain, grid: NavGrid) -> dict[str, Point]:
    """Three spread-out beacons whose walking distance from both bases is nearly equal.

    Asymmetric rivers bend the set of fair points, so beacons are not tied to fixed regions.
    They are labelled alpha → charlie from north-west to south-east across the base axis.
    """
    cyan, amber = field.bases['cyan'], field.bases['amber']
    mid = ((cyan[0] + amber[0]) / 2, (cyan[1] + amber[1]) / 2)
    dx, dy = amber[0] - cyan[0], amber[1] - cyan[1]
    norm = math.hypot(dx, dy)
    qx, qy = -dy / norm, dx / norm
    for _ in range(3):
        dc, da = grid.distances(cyan), grid.distances(amber)
        n = grid.n
        candidates = []
        for jj in range(8, n - 8, 2):
            for i in range(8, n - 8, 2):
                c, a = dc[jj * n + i], da[jj * n + i]
                if math.isinf(c) or math.isinf(a) or min(c, a) < 1300:
                    continue
                p = grid.center(i, jj)
                candidates.append((abs(c - a) / (c + a), p, _clearance(grid, p, BEACON_CLEAR)))
        for tolerance in (.03, .05, .08):
            pool = [(r, p) for r, p, clear in candidates if clear and r <= tolerance]
            if not pool:
                continue
            # Start from the fair point nearest the middle, then take the farthest-spread fair points.
            chosen = [min(pool, key=lambda c: (c[0] + math.dist(c[1], mid) / 6000, c[1]))[1]]
            while len(chosen) < 3:
                spread = [(min(math.dist(p, o) for o in chosen), r, p) for r, p in pool]
                best = max(spread, key=lambda c: (min(c[0], 2400) - c[1] * 4000, c[2]))
                if best[0] < 1300:
                    break
                chosen.append(best[2])
            if len(chosen) == 3:
                chosen.sort(key=lambda p: ((p[0] - mid[0]) * qx + (p[1] - mid[1]) * qy, p))
                return dict(zip(BEACON_NAMES, chosen))
        # Fair ground exists but is cramped: open soft obstacles around the fairest spots and re-measure.
        fair = sorted((r, p) for r, p, _ in candidates if r <= .05)[:12]
        field.obstacles = [o for o in field.obstacles if o.kind == 'water'
                           or all(math.hypot(o.x - p[0], o.y - p[1]) > o.r + BEACON_CLEAR + 120 for _, p in fair)]
        grid = NavGrid(field)
    raise LayoutRejected


def _spawns(field: Terrain, side: str) -> list[Point]:
    bx, by = field.bases[side]
    cx, cy = SIZE / 2 - bx, SIZE / 2 - by
    norm = math.hypot(cx, cy)
    fx, fy = cx / norm, cy / norm
    # Scout / vanguard / support line up across the exit of the base, facing the map centre.
    return [(round(bx + fx * 260 - fy * k, 1), round(by + fy * 260 + fx * k, 1)) for k in (-150, 0, 150)]
