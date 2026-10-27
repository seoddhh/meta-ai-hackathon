import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Callable

from .models import Battle


class Store:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / 'battles.sqlite3'
        self.on_save: Callable[[], None] | None = None
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS battles (id TEXT PRIMARY KEY, created_at TEXT, body TEXT NOT NULL)')

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def save(self, battle: Battle):
        with self.connect() as db:
            db.execute('INSERT INTO battles VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
                       (battle.id, battle.created_at, battle.model_dump_json()))
        if self.on_save:
            self.on_save()

    def get(self, battle_id: str) -> Battle | None:
        with self.connect() as db:
            row = db.execute('SELECT body FROM battles WHERE id=?', (battle_id,)).fetchone()
        return Battle.model_validate_json(row[0]) if row else None

    def list(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute('SELECT body FROM battles ORDER BY created_at DESC LIMIT 50').fetchall()
        return [{key: body[key] for key in ['id', 'name', 'mode', 'status', 'round', 'winner', 'scores', 'created_at', 'image_path']}
                for row in rows for body in [Battle.model_validate_json(row[0]).model_dump()]]
