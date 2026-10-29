"""One small paid commander call; no keys, raw headers, or raw API errors printed."""
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from .models import Battle, Unit
from .providers import ProviderError, commander, configuration
from .terrain import generate


async def check():
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    print(json.dumps(configuration(), ensure_ascii=False))
    field = generate(73184)
    b = Battle(id='smoke', created_at=datetime.now(timezone.utc).isoformat(), name='Connection test', mode='live', field=field,
               prompts={'cyan': '알파 신호 거점을 확보해.', 'amber': '찰리 신호 거점을 확보해.'},
               units=[Unit(id=f'{s}-{r}', side=s, role=r, x=p[0], y=p[1])
                      for s in ('cyan', 'amber')
                      for r, p in zip(('scout', 'vanguard', 'support'), field.spawns[s])])
    try:
        result = await commander(b, 'cyan')
        print(json.dumps({'commander_call': 'passed', 'assignments': len(result.assignments)}, ensure_ascii=False))
    except ProviderError as exc:
        print(json.dumps({'commander_call': 'failed', 'detail': str(exc)}, ensure_ascii=False))
        raise SystemExit(1)


if __name__ == '__main__':
    asyncio.run(check())
