"""Password/TOTP authentication for the temporary shared game board."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import struct
import time
from contextlib import contextmanager
from http.cookies import SimpleCookie
from pathlib import Path

COOKIE = '__Host-fieldwork'

def totp(secret, counter):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = digest[-1] & 15
    return str((struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000).zfill(6)

def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000).hex()

class Auth:
    def __init__(self, database, config=None):
        self.database = database
        if config is None:
            path = os.environ.get('AUTH_CONFIG_FILE')
            if path:
                config = json.loads(Path(path).read_text())
            elif os.environ.get('STATIC_DIR') or os.environ.get('AUTH_DISABLED_FOR_TESTS') == '1':
                config = {'disabled': True}
            else:
                raise RuntimeError('AUTH_CONFIG_FILE is required outside local development')
        self.config = config
        self.enabled = not config.get('disabled', False)
        if self.enabled:
            for key in ('salt', 'password_hash', 'totp_secret', 'expires_at', 'origins'):
                if key not in config:
                    raise RuntimeError('Incomplete authentication configuration')
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires REAL NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS auth_used_codes (counter INTEGER PRIMARY KEY)')
            db.execute('CREATE TABLE IF NOT EXISTS auth_attempts (at REAL NOT NULL)')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def token(self, cookie):
        jar = SimpleCookie()
        try:
            jar.load(cookie or '')
            return jar[COOKIE].value if COOKIE in jar else ''
        except Exception:
            return ''

    def session(self, cookie):
        if not self.enabled:
            return {'csrf': 'development', 'expires': time.time() + 3600}
        now = time.time()
        if now >= self.config['expires_at']:
            return None
        token = self.token(cookie)
        if not token or len(token) > 128:
            return None
        with self.connect() as db:
            row = db.execute('SELECT csrf, expires FROM auth_sessions WHERE token=? AND expires>?', (hashlib.sha256(token.encode()).hexdigest(), now)).fetchone()
        return {'csrf': row[0], 'expires': row[1]} if row else None

    def origin_allowed(self, headers):
        if not self.enabled:
            return True
        return headers.get('Origin', '') in self.config['origins']

    def login(self, password, code):
        now = time.time()
        if not self.enabled:
            raise ValueError('Authentication is disabled in development')
        if now >= self.config['expires_at']:
            raise ValueError('This temporary game link has expired.')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM auth_attempts WHERE at<?', (now - 300,))
            if db.execute('SELECT COUNT(*) FROM auth_attempts').fetchone()[0] >= 20:
                raise ValueError('Too many attempts. Please wait five minutes.')
            db.execute('INSERT INTO auth_attempts VALUES (?)', (now,))
        if not isinstance(password, str) or len(password) > 256 or not isinstance(code, str) or len(code) != 6 or not code.isascii() or not code.isdigit():
            raise ValueError('Password or code not accepted.')
        if not hmac.compare_digest(password_hash(password, self.config['salt']), self.config['password_hash']):
            raise ValueError('Password or code not accepted.')
        counter = int(now // 30)
        matches = [c for c in (counter - 1, counter, counter + 1) if hmac.compare_digest(totp(self.config['totp_secret'], c), code)]
        if not matches:
            raise ValueError('Password or code not accepted.')
        raw = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        expires = min(now + 48 * 3600, self.config['expires_at'])
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM auth_used_codes WHERE counter=?', (matches[0],)).fetchone():
                raise ValueError('This code was already used. Wait for the next code in your authenticator.')
            db.execute('INSERT INTO auth_used_codes VALUES (?)', (matches[0],))
            db.execute('DELETE FROM auth_used_codes WHERE counter<?', (counter - 3,))
            db.execute('DELETE FROM auth_sessions WHERE expires<?', (now,))
            db.execute('INSERT INTO auth_sessions VALUES (?, ?, ?)', (hashlib.sha256(raw.encode()).hexdigest(), csrf, expires))
        return raw, expires

    def logout(self, cookie):
        with self.connect() as db:
            db.execute('DELETE FROM auth_sessions WHERE token=?', (hashlib.sha256(self.token(cookie).encode()).hexdigest(),))
