"""CLI:  python -m app.cli sync [--force]   -> initial / manual synchronization without starting the server."""
import argparse
import json
import sys

from app.config import get_settings
from app.database import init_db, make_engine, make_session_factory
from app.services.sync_service import SyncService


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync", help="Download the latest workbook and refresh the database")
    s.add_argument("--force", action="store_true", help="Replace data even if the workbook hash is unchanged")
    args = parser.parse_args(argv)

    settings = get_settings()
    engine = make_engine(settings.database_url)
    init_db(engine)
    outcome = SyncService(settings, make_session_factory(engine)).run(force=args.force)
    print(f"[{outcome.status}] {outcome.message}")
    if outcome.report:
        print(json.dumps(outcome.report, indent=2, ensure_ascii=False, default=str))
    return 0 if outcome.ok else 1


if __name__ == "__main__":
    sys.exit(main())
