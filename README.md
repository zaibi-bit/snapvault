# SnapVault — social video downloader

Paste a link from YouTube, TikTok, Instagram, X, Facebook, Reddit and 15+ more
platforms → pick video or MP3 audio → download. Free, no sign-up, no watermark.

## How it works

- `index.html` — the whole front end (platform detection, quality picker,
  progress-bar downloads, local history).
- `api/resolve.js` — a Vercel serverless function that turns a pasted URL into a
  direct download link. It proxies the open-source [cobalt](https://github.com/imputnet/cobalt)
  API through community instances (no API key needed), with automatic failover
  if one instance is down. Video bytes download straight from the returned
  tunnel/redirect URL — they never pass through Vercel.

## Deploy

Push to GitHub, then import the repo in Vercel (or use the Vercel CLI).
No environment variables needed.

## Fair use

Only download videos you have the right to save — your own content, or content
the creator allows to be downloaded. Respect creators and their work.
