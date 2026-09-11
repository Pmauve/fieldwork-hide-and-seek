"""Create fresh group credentials; outputs are private and ignored by Git."""
import argparse
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import time
import urllib.parse

from auth import password_hash


def create(origin, days, root):
    parsed = urllib.parse.urlsplit(origin)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment or any(c.isspace() for c in origin):
        raise ValueError('Use an HTTPS origin only, e.g. https://maps.example.org')
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError('Invalid origin port')
    if not 0 < days <= 90:
        raise ValueError('Expiry must be between 0 and 90 days')
    origin = origin.rstrip('/')
    folders = [root / 'secrets', root / 'enrollment']
    if any(folder.exists() for folder in folders):
        raise ValueError('secrets/ or enrollment/ already exists; refusing to replace credentials')
    # The QR is generated locally, never by an external enrollment service.
    import qrcode
    import qrcode.image.svg
    password = secrets.token_urlsafe(24)
    seed = base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')
    salt = secrets.token_hex(16)
    config = {'salt': salt, 'password_hash': password_hash(password, salt),
              'totp_secret': seed, 'expires_at': time.time() + days * 86400,
              'origins': [origin]}
    for folder in folders:
        folder.mkdir(mode=0o700)
    def write(path, content):
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='utf-8') as file:
            file.write(content)
    write(root / 'secrets/auth.json', json.dumps(config))
    uri = 'otpauth://totp/Fieldwork:players?' + urllib.parse.urlencode(
        {'secret': seed, 'issuer': 'Fieldwork', 'algorithm': 'SHA1', 'digits': 6, 'period': 30})
    qr = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage)
    write(root / 'enrollment/authenticator.svg', qr.to_string().decode())
    expires = datetime.fromtimestamp(config['expires_at'], timezone.utc).isoformat()
    write(root / 'enrollment/access.txt',
          f'URL: {origin}\nGroup: players\nPassword: {password}\nTOTP seed: {seed}\nExpires: {expires}\n'
          'Share privately. Everyone has full workbook access. Codes are single-use.\n')
    return expires


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', required=True)
    parser.add_argument('--days', type=float, default=7)
    args = parser.parse_args()
    try:
        expiry = create(args.origin, args.days, Path.cwd())
    except (ValueError, ImportError) as error:
        parser.exit(1, f'{error}\nInstall QR support with: python -m pip install qrcode==8.2\n')
    print(f'Created secrets/auth.json and private enrollment/ files. Expires {expiry}.')
