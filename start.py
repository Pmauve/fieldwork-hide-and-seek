"""Run an unauthenticated local-only development board."""
import argparse
import os
from pathlib import Path
import runpy

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--data-dir', type=Path, default=Path(__file__).parent / 'data-local')
    args = parser.parse_args()
    if os.environ.get('AUTH_CONFIG_FILE'):
        parser.error('Use the HTTPS deployment for authentication; unset AUTH_CONFIG_FILE for local development.')
    root = Path(__file__).resolve().parent
    os.environ.update(STATIC_DIR=str(root), DATA_DIR=str(args.data_dir.resolve()), PORT=str(args.port))
    print(f'Local development only: http://127.0.0.1:{args.port}', flush=True)
    runpy.run_path(str(root / 'server.py'), run_name='__main__')
