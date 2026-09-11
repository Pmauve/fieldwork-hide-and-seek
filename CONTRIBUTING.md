# Contributing

Small, tested improvements are welcome. Open an issue before changing the map
scope, authentication model or adding a major feature.

Use synthetic workbooks in reports and screenshots. Never attach passwords,
authenticator QR codes, database files or real player locations.

Run the README tests. For UI changes, also check a narrow phone viewport,
save/reload, map switching and a second browser editing the same workbook.
Keep existing clue snapshots and exports readable. New GIS definitions need
new versioned assets, source links and licence attribution, not replacements
of existing geometry. Keep the mobile map usable without adding menu clutter.

## Screenshots

With Node.js 20+ installed, run `npm ci` and `npx playwright install chromium`.
Start `python start.py --data-dir data-screenshots` with a **new, empty** data
directory, then run `npm run screenshots` in another terminal. The script refuses
non-loopback hosts and nonempty databases. It creates only fictional demo clues.
Review the PNGs before committing. Setup tests additionally need `qrcode==8.2`:
`python -m unittest setup_test`.
