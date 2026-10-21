# JAV档案馆 (awesomejav)

Static SPA (`public/`) + Vercel serverless API (`api/`), user data in Vercel Blob.

- `public/` front-end: `index.html`, `app.js`, `auth.js`, `style.css`
- `api/` serverless functions: login / register / me / upload / feed-prefs
- `scrape.py`, `dedupe.py`, `deploy.py`, `sync_drive_uploads.py`: data pipeline and deploy scripts
- `javtext_watch/`: recommendation preference scripts

Images (covers / thumbs / samples) and data JSON are intentionally not in this repo.
Required env: `BLOB_READ_WRITE_TOKEN` (Vercel Blob).
