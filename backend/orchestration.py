import asyncio
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from .engine import resolve
from .models import Action, Battle, CommanderDecision, Event
from .providers import commander, plan_workers


class RoundState(TypedDict, total=False):
    battle: Battle
    decisions: dict[str, CommanderDecision]
    actions: dict[str, list[Action]]


async def command(state: RoundState):
    values = await asyncio.gather(*(commander(state['battle'], side) for side in ('cyan', 'amber')))
    return {'decisions': dict(zip(('cyan', 'amber'), values))}


async def execute(state: RoundState):
    return {'actions': await plan_workers(state['battle'], state['decisions'])}


def adjudicate(state: RoundState):
    battle = state['battle'].model_copy(deep=True)
    battle.commands = {side: d.summary for side, d in state['decisions'].items()}
    battle.assignments = {side: d.assignments for side, d in state['decisions'].items()}
    battle.events.extend(Event(round=battle.round + 1, side=side, kind='task',
                               message=f'{a.objective.upper()} · {a.instruction}', unit_id=a.unit_id)
                         for side, d in state['decisions'].items() for a in d.assignments)
    battle.events.extend(Event(round=battle.round + 1, side=side, kind='tool',
                               message=f'{a.kind}({a.x},{a.y})' if a.kind == 'move' else f'{a.kind}({a.target_id or "self"})', unit_id=a.unit_id)
                         for side, actions in state['actions'].items() for a in actions)
    battle.events.extend(Event(round=battle.round + 1, side=side, kind='command', message=d.summary)
                         for side, d in state['decisions'].items())
    battle.events.extend(Event(round=battle.round + 1, side=side, kind='agent',
                               message=f'{a.unit_id}: {a.rationale}', unit_id=a.unit_id)
                         for side, actions in state['actions'].items() for a in actions if a.rationale)
    return {'battle': resolve(battle, state['actions'])}


builder = StateGraph(RoundState)
builder.add_node('commanders', command)
builder.add_node('role_agents', execute)
builder.add_node('deterministic_engine', adjudicate)
builder.add_edge(START, 'commanders')
builder.add_edge('commanders', 'role_agents')
builder.add_edge('role_agents', 'deterministic_engine')
builder.add_edge('deterministic_engine', END)
round_graph = builder.compile()
