# Security

Fieldwork is a small shared-group tool, not a multi-tenant service. It has not
had an independent security audit. Only give access to people you trust with
the whole workbook. A shared password and TOTP seed do not identify individuals.

The supplied production setup requires HTTPS, a password and TOTP, checks write
origins and CSRF tokens, and uses Secure/HttpOnly/SameSite cookies. Login attempts
are globally limited, so an attacker can temporarily block legitimate logins.
There are no per-user permissions or recovery emails. Use a VPN or an additional
identity-aware proxy when appropriate; keep dependencies and the host patched.

Never publish `secrets/`, enrollment files, SQLite databases, backups or exports
containing real player locations. `.gitignore` is a safeguard, not a secret scan.
Browser storage retains workbook drafts, including after logout; clear site data
on shared devices. Map tiles and fonts contact external providers. Google Maps
short links are resolved by the server. There is no live location tracking.

Report vulnerabilities through GitHub's private vulnerability reporting feature
if the repository has it enabled. Otherwise open an issue requesting a private
contact, without exploit details, credentials or private data.
