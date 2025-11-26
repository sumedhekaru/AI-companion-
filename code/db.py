"""Database initialization and helpers for AI Companion.

Uses SQLite with SQLAlchemy Core + raw SQL (text queries only).
For now this module is responsible only for creating the database
file and the required tables.
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, text

# Database location: ../data/conversations.db relative to this file
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR.parent / "data"
DB_PATH = DATA_DIR / "conversations.db"
DB_URL = f"sqlite:///{DB_PATH}"

# Global SQLAlchemy engine (no ORM, Core + text() only for now)
engine = create_engine(DB_URL, future=True)


def init_db() -> None:
    """Initialize the SQLite database and create tables if they do not exist.

    This function is safe to call multiple times; it uses
    "CREATE TABLE IF NOT EXISTS" and "CREATE INDEX IF NOT EXISTS".
    """
    # Ensure data directory exists
    os.makedirs(DATA_DIR, exist_ok=True)

    sessions_sql = text(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            session_id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_num TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            browser_session_id TEXT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            metadata TEXT NULL
        );
        """
    )

    messages_sql = text(
        """
        CREATE TABLE IF NOT EXISTS messages (
            msg_id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_num TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            turn_index INTEGER NOT NULL,
            turn_id INTEGER NULL,
            extra TEXT NULL
        );
        """
    )

    turn_summaries_sql = text(
        """
        CREATE TABLE IF NOT EXISTS turn_summaries (
            turn_summary_id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_num TEXT NOT NULL,
            turn_id INTEGER NOT NULL,
            user_short TEXT NOT NULL,
            assistant_short TEXT NOT NULL,
            turn_summary TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            extra TEXT NULL
        );
        """
    )

    index_messages_sql = text(
        """
        CREATE INDEX IF NOT EXISTS idx_messages_session_turn
        ON messages (session_num, turn_index);
        """
    )

    index_turn_summaries_sql = text(
        """
        CREATE INDEX IF NOT EXISTS idx_turn_summaries_session_turn
        ON turn_summaries (session_num, turn_id);
        """
    )

    with engine.begin() as conn:
        conn.execute(sessions_sql)
        conn.execute(messages_sql)
        conn.execute(turn_summaries_sql)
        conn.execute(index_messages_sql)
        conn.execute(index_turn_summaries_sql)
