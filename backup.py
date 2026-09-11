"""Create a consistent SQLite backup without stopping the application."""
import argparse
from pathlib import Path
import sqlite3

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    if not args.source.is_file() or args.destination.exists():
        parser.error('Source must exist and destination must be a new file')
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    args.destination.touch(mode=0o600, exist_ok=False)
    source = sqlite3.connect(args.source.resolve().as_uri() + '?mode=ro', uri=True)
    destination = sqlite3.connect(args.destination)
    try:
        source.backup(destination)
        if destination.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Backup integrity check failed')
    finally:
        destination.close()
        source.close()
    print('Backup complete. Contains private game data and sessions; do not publish.')
