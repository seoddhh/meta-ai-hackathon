"""Seeded value-noise terrain with connected lanes and authoritative collision cells."""
import math
import random

from .models import Terrain, TerrainCell

NAMES = {'woodland': 'WHISPERING PINES', 'highland': 'GRANITE PASS', 'wetland': 'MISTWATER BASIN'}


def generate(seed: int, biome: str = 'woodland') -> Terrain:
    rng = random.Random(seed)
    size = 21
    phase = rng.uniform(0, math.tau)
    amplitude = rng.uniform(1.1, 2.6)
    lattice = [[rng.random() for _ in range(8)] for _ in range(8)]

    def noise(x, y):
        x, y = x / 3.5, y / 3.5
        ix, iy = int(x), int(y)
        tx, ty = x - ix, y - iy
        tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        return ((lattice[iy][ix] * (1-tx) + lattice[iy][ix+1] * tx) * (1-ty)
                + (lattice[iy+1][ix] * (1-tx) + lattice[iy+1][ix+1] * tx) * ty)

    centers = [10 + amplitude * math.sin(y / 4.3 + phase) for y in range(size + 1)]
    lanes = (4, 10, 16)
    beacons = {name: (round(centers[y]), y) for name, y in zip(('north', 'center', 'south'), lanes)}
    spawns = {'cyan': [(2, y) for y in lanes], 'amber': [(18, y) for y in reversed(lanes)]}
    # Three connected, clear lanes intersect the river on traversable bridges.
    protected = {(x, y) for lane in lanes for y in (lane-1, lane, lane+1) for x in range(size)}
    protected |= {(x, y) for x in (1, 2, 3, 17, 18, 19) for y in range(3, 18)}
    heights = []
    for y in range(size + 1):
        row = []
        for x in range(size + 1):
            river_d = abs(x - .5 - centers[min(y, size-1)])
            h = .25 + noise(x, y) * (3.4 if biome == 'highland' else 2.0)
            h = h * min(1, max(0, (river_d - .5) / 3.4))
            if river_d < 1.1:
                h = -.35
            row.append(round(h, 3))
        heights.append(row)
    cells = []
    for y in range(size):
        for x in range(size):
            variant = rng.random()
            river = abs(x - centers[y]) < (1.25 if biome == 'wetland' else 1.05)
            height = sum(heights[yy][xx] for yy, xx in [(y,x),(y,x+1),(y+1,x),(y+1,x+1)]) / 4
            kind, blocked = 'grass', False
            if river:
                kind, blocked = ('bridge', False) if y in lanes else ('water', True)
                height = .16 if kind == 'bridge' else -.19
            elif (x, y) in protected:
                kind = 'path' if y in lanes else 'grass'
            elif variant < (.34 if biome == 'highland' else .13):
                kind, blocked = 'rock', True
            elif variant < (.64 if biome == 'highland' else .72):
                kind, blocked = 'forest', True
            cells.append(TerrainCell(x=x, y=y, height=round(height, 3), kind=kind, blocked=blocked, variant=variant))
    return Terrain(seed=seed, biome=biome, name=NAMES[biome], size=size, heights=heights,
                   cells=cells, beacons=beacons, spawns=spawns)
