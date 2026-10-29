"""Hidden navigation grid over continuous terrain: walkability, A* paths and sight checks.

Positions stay continuous. The grid only rasterizes obstacle footprints (inflated by the unit
radius) so pathfinding and collision stay deterministic and cheap.
"""
import heapq
import math

from .models import Bridge, Obstacle, Point, Terrain

CELL = 50
UNIT_RADIUS = 40.0
SIGHT_BLOCKERS = ('forest', 'rock')
_cache: dict[tuple, 'NavGrid'] = {}


def segment_distance(p: Point, a: Point, b: Point) -> float:
    ax, ay = a
    dx, dy = b[0] - ax, b[1] - ay
    length = dx * dx + dy * dy
    t = 0.0 if length == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / length))
    return math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy)


def polyline_distance(p: Point, points: list[Point]) -> float:
    return min(segment_distance(p, a, b) for a, b in zip(points, points[1:]))


def on_bridge(p: Point, bridge: Bridge, margin: float = 0.0) -> bool:
    dx, dy = p[0] - bridge.x, p[1] - bridge.y
    c, s = math.cos(bridge.angle), math.sin(bridge.angle)
    along, across = dx * c + dy * s, -dx * s + dy * c
    return abs(along) <= bridge.length / 2 and abs(across) <= bridge.width / 2 - margin


def sight_clear(field: Terrain, a: Point, b: Point) -> bool:
    """Forest and rock circles block sight; water does not."""
    for o in field.obstacles:
        if o.kind in SIGHT_BLOCKERS and segment_distance((o.x, o.y), a, b) < o.r:
            return False
    return True


class NavGrid:
    def __init__(self, field: Terrain):
        self.cell = CELL
        self.n = n = field.size // CELL
        self.blocked = bytearray(n * n)
        for i in range(n):
            for j in range(n):
                if i in (0, n - 1) or j in (0, n - 1):
                    self.blocked[j * n + i] = 1
        for o in field.obstacles:
            self._stamp(o)
        river = field.river
        reach = river.width / 2 + UNIT_RADIUS / 2
        for a, b in zip(river.points, river.points[1:]):
            for i, j in self._cells_in_box(min(a[0], b[0]) - reach, min(a[1], b[1]) - reach,
                                           max(a[0], b[0]) + reach, max(a[1], b[1]) + reach):
                p = self.center(i, j)
                if segment_distance(p, a, b) < reach and not any(on_bridge(p, br, 30) for br in field.bridges):
                    self.blocked[j * n + i] = 1

    def _cells_in_box(self, x0: float, y0: float, x1: float, y1: float):
        n, c = self.n, self.cell
        for j in range(max(0, int(y0 // c)), min(n - 1, int(y1 // c)) + 1):
            for i in range(max(0, int(x0 // c)), min(n - 1, int(x1 // c)) + 1):
                yield i, j

    def _stamp(self, o: Obstacle):
        reach = o.r + (UNIT_RADIUS if o.kind != 'water' else UNIT_RADIUS / 2)
        for i, j in self._cells_in_box(o.x - reach, o.y - reach, o.x + reach, o.y + reach):
            cx, cy = self.center(i, j)
            if math.hypot(cx - o.x, cy - o.y) < reach:
                self.blocked[j * self.n + i] = 1

    def center(self, i: int, j: int) -> Point:
        return ((i + 0.5) * self.cell, (j + 0.5) * self.cell)

    def cell_of(self, p: Point) -> tuple[int, int]:
        return (max(0, min(self.n - 1, int(p[0] // self.cell))), max(0, min(self.n - 1, int(p[1] // self.cell))))

    def open(self, i: int, j: int) -> bool:
        return 0 <= i < self.n and 0 <= j < self.n and not self.blocked[j * self.n + i]

    def walkable(self, p: Point) -> bool:
        return 0 <= p[0] < self.n * self.cell and 0 <= p[1] < self.n * self.cell and self.open(*self.cell_of(p))

    def nearest_open(self, i: int, j: int) -> tuple[int, int] | None:
        """Closest open cell by ring search; ties resolve in a fixed scan order."""
        if self.open(i, j):
            return i, j
        for radius in range(1, self.n):
            ring = [(i + dx, j + dy) for dy in range(-radius, radius + 1) for dx in range(-radius, radius + 1)
                    if max(abs(dx), abs(dy)) == radius and self.open(i + dx, j + dy)]
            if ring:
                return min(ring, key=lambda c: (c[0] - i) ** 2 + (c[1] - j) ** 2)
        return None

    def segment_clear(self, a: Point, b: Point) -> bool:
        steps = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / (self.cell / 2)))
        return all(self.walkable((a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps))
                   for k in range(1, steps + 1))

    def neighbours(self, i: int, j: int):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if self.open(i + dx, j + dy):
                yield i + dx, j + dy, 1.0
        for dx, dy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            # No corner cutting: both orthogonal cells must be open.
            if self.open(i + dx, j + dy) and self.open(i + dx, j) and self.open(i, j + dy):
                yield i + dx, j + dy, math.sqrt(2)

    def distances(self, start: Point) -> list[float]:
        """Dijkstra path length (world units) from a point to every open cell; inf if unreachable."""
        n = self.n
        dist = [math.inf] * (n * n)
        origin = self.nearest_open(*self.cell_of(start))
        if not origin:
            return dist
        dist[origin[1] * n + origin[0]] = 0.0
        queue = [(0.0, origin)]
        while queue:
            d, (i, j) = heapq.heappop(queue)
            if d > dist[j * n + i]:
                continue
            for x, y, cost in self.neighbours(i, j):
                nd = d + cost * self.cell
                if nd < dist[y * n + x]:
                    dist[y * n + x] = nd
                    heapq.heappush(queue, (nd, (x, y)))
        return dist

    def find_path(self, start: Point, goal: Point) -> list[Point] | None:
        """A* over cells, then string-pulled into a short polyline from start to the (snapped) goal."""
        s = self.cell_of(start)
        g = self.nearest_open(*self.cell_of(goal))
        if g is None:
            return None
        end = goal if self.walkable(goal) else self.center(*g)
        if not self.open(*s):
            s = self.nearest_open(*s) or s
        h = lambda c: math.hypot(c[0] - g[0], c[1] - g[1])
        best = {s: 0.0}
        parent: dict[tuple[int, int], tuple[int, int]] = {}
        queue = [(h(s), 0.0, s)]
        while queue:
            _, d, current = heapq.heappop(queue)
            if current == g:
                break
            if d > best.get(current, math.inf):
                continue
            for x, y, cost in self.neighbours(*current):
                nd = d + cost
                if nd < best.get((x, y), math.inf):
                    best[(x, y)] = nd
                    parent[(x, y)] = current
                    heapq.heappush(queue, (nd + h((x, y)), nd, (x, y)))
        else:
            if s != g:
                return None
        cells = [g]
        while cells[-1] != s:
            cells.append(parent[cells[-1]])
        raw = [start] + [self.center(*c) for c in reversed(cells[1:-1])] + [end]
        path = [raw[0]]
        i = 0
        while i < len(raw) - 1:
            j = i + 1
            while j + 1 < len(raw) and self.segment_clear(raw[i], raw[j + 1]):
                j += 1
            path.append(raw[j])
            i = j
        return path


def nav(field: Terrain) -> NavGrid:
    key = (field.seed, field.biome, field.size, field.river.width, tuple(field.river.points),
           tuple((o.kind, o.x, o.y, o.r) for o in field.obstacles),
           tuple((b.x, b.y, b.angle, b.length, b.width) for b in field.bridges))
    grid = _cache.get(key)
    if grid is None:
        if len(_cache) > 32:
            _cache.clear()
        grid = _cache[key] = NavGrid(field)
    return grid


def advance_along(path: list[Point], budget: float) -> list[Point]:
    """Prefix of a polyline no longer than budget world units."""
    out = [path[0]]
    for a, b in zip(path, path[1:]):
        step = math.hypot(b[0] - a[0], b[1] - a[1])
        if step <= budget:
            out.append(b)
            budget -= step
        else:
            if budget > 0:
                t = budget / step
                out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            break
    return out


def path_length(path: list[Point]) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(path, path[1:]))
