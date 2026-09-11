"""Small private workbook API. SQLite commits and revision checks protect shared edits."""
import json
import mimetypes
import os
import re
import sqlite3
import time
import urllib.parse
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import hmac
from auth import Auth, COOKIE

DB = Path(os.environ.get('DATA_DIR', './data')) / 'workbook.sqlite3'
DB.parent.mkdir(parents=True, exist_ok=True)

@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=10)
    try:
        db.execute('PRAGMA journal_mode=WAL')
        with db:
            yield db
    finally:
        db.close()

with connect() as db:
    db.execute('CREATE TABLE IF NOT EXISTS workbook (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS history (revision INTEGER PRIMARY KEY, body TEXT NOT NULL, saved REAL NOT NULL)')
    initial = {'version': 2, 'rounds': [{'id': 'round-1', 'name': 'Round 1', 'items': []}]}
    db.execute('INSERT OR IGNORE INTO workbook VALUES (1, 0, ?)', (json.dumps(initial),))

auth = Auth(DB)

def validate_book(book):
    if not isinstance(book, dict) or book.get('version') != 2:
        raise ValueError('Unsupported workbook version')
    rounds = book.get('rounds')
    if not isinstance(rounds, list) or not 1 <= len(rounds) <= 100:
        raise ValueError('A workbook needs 1-100 rounds')
    ids = set()
    for r in rounds:
        if not isinstance(r, dict) or not isinstance(r.get('id'), str) or r['id'] in ids:
            raise ValueError('Invalid or duplicate round ID')
        ids.add(r['id'])
        if not isinstance(r.get('name'), str) or len(r['name']) > 120:
            raise ValueError('Invalid round name')
        if not isinstance(r.get('items'), list) or len(r['items']) > 500:
            raise ValueError('Too many items')
        item_ids = set()
        for item in r['items']:
            if not isinstance(item, dict) or not isinstance(item.get('id'), str) or item['id'] in item_ids:
                raise ValueError('Invalid item ID')
            item_ids.add(item['id'])
            if item.get('type') not in ('radar', 'thermometer', 'admin', 'matching', 'measuring', 'drawing', 'note'):
                raise ValueError('Invalid item type')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def resolve_pin(raw):
    url = raw.strip()
    for _ in range(5):
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != 'https' or parsed.hostname not in ('maps.app.goo.gl', 'goo.gl', 'www.google.com', 'maps.google.com', 'google.com') or parsed.port not in (None, 443) or parsed.username:
            raise ValueError('Use a Google Maps HTTPS share link or paste coordinates')
        if parsed.hostname not in ('maps.app.goo.gl', 'goo.gl'):
            break
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'JetlagPrivateMap/2'})
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=8) as response:
                url = response.url
                break
        except urllib.error.HTTPError as error:
            if error.code not in (301, 302, 303, 307, 308):
                raise ValueError('Google link could not be resolved') from error
            url = urllib.parse.urljoin(url, error.headers['Location'])
    decoded = urllib.parse.unquote(url)
    match = re.search(r'!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)', decoded)
    if not match:
        match = re.search(r'(?:[?&](?:q|query)=|/search/)(-?\d+\.?\d*)[, +]+(-?\d+\.?\d*)', decoded)
    if not match:
        raise ValueError('No unambiguous pin coordinates. Share a dropped pin or paste latitude, longitude.')
    lat, lng = map(float, match.groups())
    if not -90 <= lat <= 90 or not -180 <= lng <= 180:
        raise ValueError('Invalid coordinates')
    return {'lat': lat, 'lng': lng}

class Handler(BaseHTTPRequestHandler):
    def local_request_allowed(self):
        if not os.environ.get('STATIC_DIR'):
            return True
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        return host in allowed and (origin is None or origin == 'http://' + host)

    def reply(self, code, data, cookie=None):
        payload = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if not self.local_request_allowed():
            return self.reply(403, {'error': 'Local development requests only'})
        if self.path == '/api/health':
            return self.reply(200, {'ok': True})
        session = auth.session(self.headers.get('Cookie'))
        if self.path == '/auth/check':
            self.send_response(204 if session else 401)
            self.end_headers()
            return
        if self.path == '/auth/session':
            return self.reply(200 if session else 401, {'authenticated': bool(session), **(session or {})})
        if auth.enabled and not session:
            return self.reply(401, {'error': 'Please sign in again. Your draft is retained.'})
        if self.path != '/api/workbook':
            if os.environ.get('STATIC_DIR'):
                root = Path(os.environ['STATIC_DIR']).resolve()
                relative = urllib.parse.unquote(urllib.parse.urlparse(self.path).path).lstrip('/') or 'index.html'
                target = (root / relative).resolve()
                allowed = relative in ('index.html', 'styles.css', 'layout.css', 'app.js', 'geometry.js', 'measurement-worker.js', 'login.html', 'login.js', 'login.css') or relative.startswith(('assets/', 'vendor/'))
                if allowed and target.is_relative_to(root) and target.is_file():
                    payload = target.read_bytes()
                    self.send_response(200)
                    self.send_header('Content-Type', mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
                    self.send_header('Content-Length', str(len(payload)))
                    self.end_headers()
                    return self.wfile.write(payload)
            return self.reply(404, {'error': 'Not found'})
        with connect() as db:
            revision, body = db.execute('SELECT revision, body FROM workbook WHERE id=1').fetchone()
        self.reply(200, {'revision': revision, 'book': json.loads(body)})

    def do_POST(self):
        if not self.local_request_allowed():
            return self.reply(403, {'error': 'Local development requests only'})
        try:
            form_login = self.path == '/auth/login' and self.headers.get('Content-Type', '').startswith('application/x-www-form-urlencoded')
            if not form_login and not self.headers.get('Content-Type', '').startswith('application/json'):
                return self.reply(415, {'error': 'JSON required'})
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 8000000:
                return self.reply(413, {'error': 'Request too large'})
            raw = self.rfile.read(size)
            data = {k:v[-1] for k,v in urllib.parse.parse_qs(raw.decode(), max_num_fields=8).items()} if form_login else json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Invalid number')))
            if not isinstance(data, dict):
                raise ValueError('JSON object required')
            if auth.enabled:
                if not auth.origin_allowed(self.headers):
                    return self.reply(403, {'error': 'Origin not allowed'})
                if self.path == '/auth/login':
                    try:
                        token, expires = auth.login(data.get('password'), data.get('code'))
                        cookie = f'{COOKIE}={token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age={max(0, int(expires-time.time()))}'
                        if form_login:
                            self.send_response(303)
                            self.send_header('Location', '/')
                            self.send_header('Set-Cookie', cookie)
                            self.send_header('Cache-Control', 'no-store')
                            self.send_header('Content-Length', '0')
                            self.end_headers()
                            return
                        return self.reply(200, {'ok': True}, cookie)
                    except ValueError as error:
                        return self.reply(401, {'error': str(error)})
                session = auth.session(self.headers.get('Cookie'))
                if not session:
                    return self.reply(401, {'error': 'Please sign in again. Your draft is retained.'})
                if not hmac.compare_digest(self.headers.get('X-Fieldwork-CSRF', ''), session['csrf']):
                    return self.reply(403, {'error': 'Refresh the page before saving'})
                if self.path == '/auth/logout':
                    auth.logout(self.headers.get('Cookie'))
                    return self.reply(200, {'ok': True}, f'{COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0')
            if self.path == '/api/resolve':
                return self.reply(200, resolve_pin(str(data.get('url', ''))[:4096]))
            if self.path != '/api/workbook':
                return self.reply(404, {'error': 'Not found'})
            validate_book(data.get('book'))
            body = json.dumps(data['book'], ensure_ascii=False, allow_nan=False)
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                revision, old = db.execute('SELECT revision, body FROM workbook WHERE id=1').fetchone()
                if data.get('revision') != revision:
                    return self.reply(409, {'error': 'Another device saved changes', 'revision': revision, 'book': json.loads(old)})
                db.execute('INSERT OR REPLACE INTO history VALUES (?, ?, ?)', (revision, old, time.time()))
                db.execute('DELETE FROM history WHERE revision < ?', (revision - 100,))
                db.execute('UPDATE workbook SET revision=?, body=? WHERE id=1', (revision + 1, body))
            self.reply(200, {'revision': revision + 1})
        except (ValueError, TypeError, KeyError) as error:
            self.reply(400, {'error': str(error)})
        except Exception:
            self.reply(503, {'error': 'Service temporarily unavailable; your local draft is retained'})

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1' if os.environ.get('STATIC_DIR') else '0.0.0.0', int(os.environ.get('PORT', 8081))), Handler).serve_forever()
