# Self-hosting

One deployment holds one shared workbook. Run a separate deployment for unrelated
groups. A dedicated HTTPS hostname is required; hosting under a URL subpath is
not supported. Do not publish Python's local development server.

## Docker Compose

On a Linux host with Docker Compose and Python 3.11+:

```sh
python -m venv .venv
.venv/bin/pip install qrcode==8.2
.venv/bin/python make_access.py --origin https://maps.example.org --days 7
mkdir -p data
sudo chown 1000:1000 data secrets/auth.json
sudo chmod 700 data
sudo chmod 400 secrets/auth.json
docker compose up -d
```

Replace the example origin with your exact external HTTPS address, including a
nonstandard port if used. The QR dependency is only for setup. Application runtime
uses Python's standard library. Protect `enrollment/` with your host's permissions
(including Windows ACLs if generating there), and never copy it into a web root.

The web container listens on **127.0.0.1:9130**. The API has no published port.
Put your HTTPS reverse proxy in front of that loopback endpoint, forwarding the
original `Host`, `Origin`, cookies and request bodies. Both services must remain
private behind the proxy. If the proxy is in another container or host, configure
private networking deliberately rather than exposing port 9130 on every interface.

Share the password and `enrollment/authenticator.svg` privately with your group.
Everyone uses the same seed; if two people sign in together, the second may need
to wait for the next 30-second code. Sessions last at most 48 hours and all access
ends at the configured expiry. Keep the server clock synchronised.

Check that `/login` loads, anonymous `/api/workbook` returns 401, and a signed-in
user can save and reload a clue. Review [security limitations](../SECURITY.md)
before making a server public. Update container images and dependencies as needed;
the supplied versions are a reproducible baseline, not a patch subscription.

## Data and updates

`data/workbook.sqlite3` persists across container recreation. Back up through
**Tools > Export workbook**, or use a consistent SQLite backup:

```sh
sudo python backup.py data/workbook.sqlite3 backups/before-update.sqlite3
docker compose up -d --force-recreate
```

Use a new backup filename each time. Never replace `data/` or `secrets/` during a
code update. Do not copy only the SQLite file while it is running: WAL writes may
be missing. SQLite backups also include session records; keep them private.
JSON imports add rounds rather than replace the whole workbook.

To restore a SQLite backup, stop the containers, preserve the current **entire**
data directory under a new private name, create an empty data directory, and copy
the backup into it as `workbook.sqlite3`. Restore ownership to UID/GID 1000, then
start the containers. Do not combine a restored database with old WAL/SHM files.

Changing the password/seed alone does not revoke existing sessions. To revoke
access immediately, stop the service or expire its configuration and restart the
API. Rotate credentials and clear session records before reopening after a leak.

After the event, export/back up, run `docker compose down` and remove this app's
public proxy route. Data remains on disk. Do not reset unrelated proxy routes.
