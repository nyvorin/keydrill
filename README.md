# keydrill

A local-first, offline typing trainer for split, column-staggered, three-layer keyboards
(Iris-class: 4×6 per hand + 4 thumb keys). It teaches you to _code_ on the board — the
`{ } [ ] ( ) + - | ~` symbols and the numpad that live on the **Lower** layer — by drilling
the hold-layer-then-tap chords until they are automatic.

Built with Tauri 2 (Rust + SQLite) and Svelte 5 (runes) + TypeScript, managed by the Vite+
toolchain (`vp`). macOS-first. No network calls, ever: the corpus, the layout and your stats
all live on this machine.

## The three layers

| Layer            | Held with         | What lives there                                                                                                                     |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Base**         | —                 | Letters, the number row (`1!`–`0)`), base punctuation, `Enter` / `Tab` / `Backspace` / `Home` / `End` / `Space` on the thumbs.       |
| **Lower (Fn 1)** | Left inner thumb  | The coding core: `~ ! @ # $ % ^ & * ( ) [ ] { } + - \| \` plus the numpad `P0`–`P9` and `←↓↑→` / `PgUp` / `PgDn` / `Delete`.         |
| **Raise (Fn 2)** | Right inner thumb | `F1`–`F12`, `= \ + -`, `Home` / `End`, and the media / RGB keys (media and RGB are **not** trainable — the webview never sees them). |

A skill is one `(layer, key)` pair — `7` on Base (`base:R01`) and `P7` on Lower (`lower:R11`)
are different skills even though both send `7`. Shift variants share their base skill.

## Start here: run the wizard first

`layout.json` was transcribed from the keyboard's layout card, so **before you train, run the
layout verification wizard** at `#/wizard` (also linked from Settings). It walks every
trainable `(layer, key)` pair, records what your firmware actually sends, and reports every
mismatch as `expected X got Y` with a "Copy report" button. Fix `src/lib/layout/layout.json`
from that report — the wizard is the authority on the layout, not the transcription. Re-run it
after any firmware remap.

## Quick start

```bash
vp install                        # install JS dependencies
pnpm exec playwright install chromium   # once, for the e2e smoke suite
npm run tauri dev                 # desktop app (Rust backend + SQLite)
```

## Development

```bash
vp dev                     # frontend only, http://localhost:5173 (MockBackend, no Tauri)
npm run tauri dev          # full desktop app against the Rust/SQLite backend
vp check                   # format + lint + typecheck
```

The frontend runs fully in a plain browser: `getBackend()` returns the **MockBackend**
(in-memory + `localStorage` key `keydrill.mock.v1`) unless `__TAURI_INTERNALS__` is present, in
which case it returns the **TauriBackend** (IPC to Rust). All browser-based development and the
Playwright suite use the mock.

### Routes

`#/` today's session · `#/reference` layer map + char lookup · `#/train` stages ·
`#/drill?stage=N` drill runner · `#/code` code copy · `#/session` daily session ·
`#/stats` dashboard · `#/settings` · `#/wizard` layout verification.

## Testing

```bash
vp test                            # Vitest — layout index, typing engine, adaptive engine, curriculum, mock backend
cd src-tauri && cargo test         # Rust — EWMA, trends, heatmap, streak, reminder, SQLite store
npx playwright test --config e2e/playwright.config.ts   # e2e smoke suite (or: pnpm run e2e)
```

This repo is pnpm-managed, so in practice run the suite as `pnpm exec playwright test --config
e2e/playwright.config.ts` or `pnpm run e2e`.

The Playwright suite builds the frontend, serves it with `vp preview --port 4173` and runs
three smoke specs against the MockBackend: the reference map renders all three layers, a
stage-3 drill accepts keystrokes end to end and produces a summary, and the stats dashboard
renders after a session is seeded.

## Building

```bash
vp build             # frontend → dist/
npm run tauri build  # → src-tauri/target/release/bundle/macos/keydrill.app
```

## Where your data lives

- Packaged app: SQLite at `~/Library/Application Support/com.webmech.keydrill/keydrill.db`
  (`sessions`, `keystroke_events`, `skills`, `days`, `settings`).
- Browser / `vp dev`: `localStorage` key `keydrill.mock.v1`.

## Project layout

```
src/            Svelte 5 SPA — lib/layout (layout.json + reverse index + skills),
                lib/engine (target prep, typing reducer, metrics), lib/adaptive (EWMA,
                scheduler, generator), lib/curriculum, lib/corpus, lib/backend, components/, views/
src-tauri/      Rust — core/ (pure stats, streak, reminder, Clock), store/ (rusqlite +
                migrations), commands.rs, reminder.rs
e2e/            Playwright config + smoke suite
docs/           Design spec and implementation plan
```
