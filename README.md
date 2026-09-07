<p align="center">
  <img src="src-tauri/icons/app-icon.svg" width="160" alt="keydrill — a circuit-heart keycap" />
</p>

<h1 align="center">keydrill</h1>

<p align="center">
  <em>Learn to type — and code — on your split, column-staggered, three-layer keyboard.</em>
</p>

<p align="center">
  <a href="https://keeb.io/products/iris-rev-8-keyboard-split-ergonomic-keyboard">Keebio Iris Rev. 8</a>
  ·
  Tauri 2 + Svelte 5
  ·
  local-first, offline, yours
</p>

---

A local-first, offline typing trainer for split, column-staggered, three-layer keyboards
(Iris-class: 4×6 per hand + 4 thumb keys). It teaches you to _code_ on the board — the
`{ } [ ] ( ) + - | ~` symbols and the numpad that live on the **Lower** layer — by drilling
the hold-layer-then-tap chords until they are automatic.

Built with Tauri 2 (Rust + SQLite) and Svelte 5 (runes) + TypeScript, managed by the Vite+
toolchain (`vp`). macOS-first. No network calls, ever: the corpus, the layout and your stats
all live on this machine.

## Supported keyboards

| Board                                                                                                                                    | Status                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Keebio Iris Rev. 8](https://keeb.io/products/iris-rev-8-keyboard-split-ergonomic-keyboard) ([docs](https://docs.keeb.io/iris-keyboard)) | **Verified** — `layout.json` is trued up against the stock [QMK default keymap](https://github.com/qmk/qmk_firmware/blob/master/keyboards/keebio/iris/keymaps/default/keymap.json), and the board identity was confirmed over USB (`0xCB10` / "Iris Rev. 8"). |
| [Keebio Iris CE / SE](https://keeb.io/products/iris-keyboard-split-ergonomic-keyboard)                                                   | Should work as-is — the CE's default keymap is keycode-for-keycode identical to the Rev. 8's.                                                                                                                                                                 |
| Anything else                                                                                                                            | The board is pure data: edit `src/lib/layout/layout.json` (keys, layers, geometry) and the reference map, hints, drills and stats all follow. The in-app wizard verifies your edit key by key.                                                                |

If you remap your board in [VIA](https://usevia.app), re-run the layout verification wizard
(`Settings → Open the layout verification wizard`) — it walks every trainable `(layer, key)`
pair, records what the firmware actually sends, and reports each mismatch as `expected X got Y`.

## The three layers

| Layer            | Held with         | What lives there                                                                                                                     |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Base**         | —                 | Letters, the number row (`1!`–`0)`), base punctuation, `Enter` / `Tab` / `Backspace` / `Home` / `End` / `Space` on the thumbs.       |
| **Lower (Fn 1)** | Left inner thumb  | The coding core: `~ ! @ # $ % ^ & * ( ) [ ] { } + - \| \` plus the numpad `P0`–`P9` and `←↓↑→` / `PgUp` / `PgDn` / `Delete`.         |
| **Raise (Fn 2)** | Right inner thumb | `F1`–`F12`, `= \ + -`, `Home` / `End`, and the media / RGB keys (media and RGB are **not** trainable — the webview never sees them). |

A skill is one `(layer, key)` pair — `7` on Base (`base:R01`) and `P7` on Lower (`lower:R11`)
are different skills even though both send `7`. Shift variants share their base skill.

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
