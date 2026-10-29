<div align="center">
 <img src="public/sounddesk_thumbnail.png" width="70%" alt="SoundDesk">

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-teal.svg)](LICENSE)

</div>

_**A quiet workspace for audio.**_

**SoundDesk** is a lean, local-first audio PWA: a distraction-free player for music, talks, podcasts and live audio from the public catalogs it connects to. Queues, playlists, lyrics and offline caching are built in, and everything about your listening stays on your device.

SoundDesk is a rebranded fork of [ytify](https://github.com/n-ce/ytify) by [n-ce](https://github.com/n-ce). The player, streaming pipeline and backend are the work of the original project and its contributors; this fork changes branding, UI copy and defaults.

## Features

- **Efficient streaming:** low-buffer audio playback that keeps going on slow networks.
- **Queue management:** add, remove and reorder tracks with full control.
- **Playlists and collections:** build local collections and import playlists from a link.
- **Dynamic theming:** the interface adapts to the artwork of the current stream.
- **Progressive Web App:** installable, with a service worker for offline use.
- **Radio mode:** discover and queue similar tracks for continuous listening.
- **Personal library:** history, favorites and channel subscriptions.
- **Offline audio:** download streams for playback without a network.
- **Synced lyrics:** time-aligned lyrics via [LRCLIB](https://lrclib.net).
- **On-device recommendations:** a "For You" feed generated locally, with no telemetry.
- **Search with suggestions:** filter songs, videos, albums, playlists and channels.

## Usage

- **Live instance:** deploy your own (see below); this fork does not ship a public instance.
- **In-app guide:** open Search → About → "Easy Usage Guide".

## Development

1. Prerequisites: [Bun](https://bun.sh) and a working knowledge of SolidJS.
2. Clone the fork and install dependencies:

```sh
git clone https://github.com/luthfi55/ytify
cd ytify
bun install
```

3. Start the dev server:

```sh
bun run dev
```

4. Qualify a change before pushing:

```sh
bun run lint
bun test scripts/
bun run tsc --noEmit
bun run build
```

Useful references: [technology inventory](docs/systems/technologies.md), [streaming guide](docs/systems/streaming.md), [code quality standards](docs/systems/code-quality.md).

## Deployment

The frontend is static (`dist/`) and can be hosted on Netlify, Cloudflare Pages or any static host. The API lives in a Cloudflare Worker (`src/backend/`) with Durable Objects + SQLite.

1. Build with `bun run build`.
2. Publish `dist/` to your host.
3. Deploy the worker and set the API hostname in `src/store.ts` if you run your own backend.
4. Point a custom domain at the frontend, then set it in:
   - `src/brand.ts` → `domain`
   - `index.html` → `og:url` and `canonical`
   - `src/backend/worker.ts` → `ALLOWED_ORIGINS` (keep the existing token header name — it is an API contract)

## Translations

Locale files live in `src/locales/*.json` (CRLF, UTF-8, 2-space indent). Keep the key set and key order identical across all locales; `src/locales/en.json` is the source of truth.

## License

[GPL-3.0](LICENSE). Original project: [n-ce/ytify](https://github.com/n-ce/ytify) — Copyright the ytify contributors. This fork preserves the same license and credits.

## Acknowledgements

- [n-ce](https://github.com/n-ce) and the [ytify](https://github.com/n-ce/ytify) contributors — the original project this fork is built on.
- [Shashwat](https://github.com/Shashwat-CODING) — streaming services.
- [InnerTube API](https://github.com/LuanRT/YouTube.js) — backend library.
- [Solid.js](https://www.solidjs.com/) — UI library.
- [LRCLIB](https://lrclib.net) — synced lyrics.
- [Netlify](https://www.netlify.com) — hosting, PR previews, edge functions.
- [Vite](https://vitejs.dev) — dev server and bundling.
- [Remix Icons](https://github.com/Remix-Design/RemixIcon) — icon set.

SoundDesk is not affiliated with or endorsed by the original project's maintainers.
