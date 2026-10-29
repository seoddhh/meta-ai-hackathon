from typing import Literal

from pydantic import BaseModel, Field

Side = Literal['cyan', 'amber']
Role = Literal['scout', 'vanguard', 'support']
Point = tuple[float, float]
Objective = Literal['alpha', 'bravo', 'charlie']


class Unit(BaseModel):
    id: str
    side: Side
    role: Role
    x: float
    y: float
    hp: int = 5
    shield: int = 0
    scan_until: int = 0
    path: list[Point] = Field(default_factory=list)
    goal: Point | None = None


class Obstacle(BaseModel):
    """Circle footprint in world units. Forest/rock block movement and sight; water blocks movement only."""
    kind: Literal['forest', 'rock', 'water']
    x: float
    y: float
    r: float


class River(BaseModel):
    points: list[Point]
    width: float


class Bridge(BaseModel):
    x: float
    y: float
    angle: float
    length: float
    width: float


class Terrain(BaseModel):
    version: Literal[3] = 3
    seed: int
    biome: Literal['woodland', 'highland', 'wetland']
    name: str
    size: int = 5000
    heights: list[list[float]]
    obstacles: list[Obstacle]
    river: River
    bridges: list[Bridge]
    bases: dict[str, Point]
    beacons: dict[str, Point]
    spawns: dict[str, list[Point]]


class TerrainRequest(BaseModel):
    seed: int = Field(default=73184, ge=0, le=2147483647)
    biome: Literal['woodland', 'highland', 'wetland'] = 'woodland'


class Action(BaseModel):
    unit_id: str
    kind: Literal['move', 'pulse', 'shield', 'repair', 'scan', 'hold']
    x: float | None = None
    y: float | None = None
    target_id: str | None = None
    rationale: str = Field(default='', max_length=240)


class WorkerDecision(BaseModel):
    action: Action


class Assignment(BaseModel):
    unit_id: str
    objective: Objective
    instruction: str = Field(max_length=240)


class CommanderDecision(BaseModel):
    summary: str = Field(max_length=400)
    assignments: list[Assignment] = Field(max_length=3)


class Event(BaseModel):
    round: int
    side: str
    kind: str
    message: str
    unit_id: str | None = None


class Frame(BaseModel):
    round: int
    units: list[Unit]
    scores: dict[str, int]
    owners: dict[str, str | None]
    events: list[Event] = Field(default_factory=list)


class Battle(BaseModel):
    id: str
    created_at: str
    name: str
    mode: Literal['rehearsal', 'live']
    status: Literal['ready', 'playing', 'finished'] = 'ready'
    round: int = 0
    max_rounds: int = 30
    prompts: dict[str, str]
    units: list[Unit]
    scores: dict[str, int] = Field(default_factory=lambda: {'cyan': 0, 'amber': 0})
    owners: dict[str, str | None] = Field(default_factory=lambda: {'alpha': None, 'bravo': None, 'charlie': None})
    events: list[Event] = Field(default_factory=list)
    frames: list[Frame] = Field(default_factory=list)
    commands: dict[str, str] = Field(default_factory=dict)
    providers: dict[str, str] = Field(default_factory=dict)
    winner: str | None = None
    image_path: str | None = None
    field: Terrain
    unit_prompts: dict[str, str] = Field(default_factory=dict)
    assignments: dict[str, list[Assignment]] = Field(default_factory=dict)


class CreateBattle(TerrainRequest):
    name: str = Field(default='The Meridian Trial', min_length=1, max_length=60)
    mode: Literal['rehearsal', 'live'] = 'rehearsal'
    cyan_prompt: str = Field(default='정찰대는 알파 거점을 확보하고, 선봉은 브라보를 지켜. 지원대는 손상된 아군을 수리해.', max_length=1200)
    amber_prompt: str = Field(default='찰리 거점을 먼저 확보해. 선봉은 브라보로 전진하고 지원대는 대형을 유지해.', max_length=1200)


class AdvanceBattle(BaseModel):
    expected_round: int = Field(ge=0, le=48)


class PromptUpdate(BaseModel):
    side: Side
    prompt: str = Field(min_length=1, max_length=1200)
    unit_id: str | None = None
