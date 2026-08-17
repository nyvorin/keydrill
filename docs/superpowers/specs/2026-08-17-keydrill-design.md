# keydrill — Design Spec

**Date:** 2026-08-17
**Status:** Approved design, pending implementation plan
**Owner:** Mike

## Purpose

A Tauri desktop app that teaches Mike to type — and specifically to *code* — on his new split, column-staggered, layered keyboard (Iris/Lily58-class: 4×6 per hand + 4-key thumb clusters, three layers: Base, Lower/Fn1, Raise/Fn2). The app is a daily-training companion: an accurate interactive reference of all three layers, plus a drill engine that builds muscle memory for base typing and for the layer-chord symbols that coding demands, in JS, TS, HTML, CSS, PHP, Rust, Go, Java, Kotlin, and SQL (Postgres flavor).

Core insight: on this board nearly every coding symbol (`{ } [ ] ( ) + - | ~` and the numpad) lives on the **Lower** layer. Learning to code on it means drilling *hold-layer-then-tap* chords until automatic. The app therefore knows, for every character, which layer + physical key + hand/finger produces it, and treats "same physical key, different layer" as distinct skills.

## Decisions already made

| Decision | Choice |
|---|---|
| Typing surface | **Strict trainer pane** — no editor smarts ever type for the user; every char is earned. Not Monaco. |
| Training model | **Adaptive + curriculum** — staged lessons with mastery gates, plus keybr-style per-skill adaptivity driving generated drills. |
| Content source | **Bundled corpus** — curated offline snippets + idiom lines per language. |
| Daily launch | **Tray-resident** with a once-per-day reminder and 30 min / 1 hr / 6 hr snooze. |
| Architecture | **Layout-as-data**: one `layout.json` drives the reference map, hints, and the adaptive engine's skill vocabulary. |
| Stack | Tauri 2, Svelte 5 + TypeScript, **Vite+ toolchain (`vp`)**, Rust + SQLite backend. |

## 1. Stack & app shell

- **Tauri 2** (macOS-first; cross-platform comes free but is not a goal).
- **Svelte 5 + TypeScript** frontend, scaffolded/managed by the **Vite+ toolchain**: `vp dev`, `vp build`, `vp test` (Vitest), `vp lint` (Oxlint), `vp fmt` (Oxfmt), `vp check`. Tauri's `devUrl` points at the `vp dev` server; `beforeBuildCommand` is `vp build`.
- **Rust backend** owns SQLite (rusqlite) and exposes Tauri commands for event ingestion, aggregation, and settings. All stats math that feeds the UI ships from Rust.
- Tauri plugins: `autostart` (launch at login, hidden), `notification`, tray via the built-in tray API. When the last window closes, macOS activation policy switches to *accessory* (no Dock icon; tray only).
- Fully offline. No network calls.

## 2. Layout core (`layout.json`)

Single source of truth describing the physical board and its layers.

```jsonc
{
  "board": "iris-class split, 4x6 + 4 thumbs per hand",
  "layers": ["base", "shift", "lower", "raise"],
  "keys": [
    {
      "id": "L_r1_c1",              // stable key id
      "hand": "left", "row": 1, "col": 1,
      "x": 0, "y": 0.375, "rot": 0, // render units; thumbs use rot
      "finger": "pinky",
      "legends": { "base": "Esc", "lower": "~", "raise": "F12" },
      "output": {                    // what the OS receives
        "base": { "key": "Escape" },
        "lower": { "char": "~" },
        "raise": { "key": "F12" }
      }
    }
    // … every key on both hands + thumb clusters
  ]
}
```

- `output` entries are either a printable `char` (with `shift` variants on base: `1`/`!`) or a named `key` (`Enter`, `ArrowLeft`, `F7`, `Home`…). Modifier/hold keys (`Lower`, `Raise`, `Shift`, `Ctrl`…) are `role: "modifier"` and produce nothing themselves.
- Derived at load, in TS:
  - **Reverse index** `char|key → [recipes]`, each recipe = `{layer, keyId, hand, finger, holds: ["lower"]…}`. Multiple routes are real (`(` exists as Base `Shift+9`, Lower top-row, and a Lower thumb key); each char has a **preferred route** (default policy: fewest holds, then strongest finger; overridable per char in settings).
  - **Skill vocabulary**: one skill per `(layer, keyId)` producing output — `7` on Base and `P7` on Lower are separate skills.
- **Known limitation (accepted):** the OS reports only the resulting char/key, so for multi-route chars, stats attribute to the char, not to which route was used. Drills still *instruct* a route in the hint text.
- **Layout verification wizard** (in Settings): walks every key × layer, prompts "hold Lower, press this key," records what actually arrives, and flags mismatches against `layout.json`. This catches transcription errors from the photo and future firmware remaps. Media/RGB keys are skipped (invisible to the webview).

### 2.1 Layer transcription (from the layout card photo — to be confirmed by the wizard)

**Base** — left: `Esc/`` ` `` | number row `1!`–`5%` | `Tab` QWERT | `Ctrl` ASDFG | `Shift` ZXCVB; right: `6^`–`0)` `Backspace` | YUIOP `Delete` | HJKL `;:` `'"` | NM `,<` `.>` `/?` `Shift`. Thumbs left→inner: `Win(Cmd)`, `Lower(Fn1)`, `Home`, `Enter`; right inner→outer: `End`, `Space`, `Raise(Fn2)`, `Alt(Opt)`.

**Lower (Fn1)** — left: `~` `!` `@` `#` `$` `%` | `` ` `` `↑` `Boot` | `Delete` `←` `↓` `→` `[` | `RGB Mode` … `{`; thumb area: `(`, `Delete`. Right: `^` `&` `*` `(` `)` `PgUp` | `P7` `P8` `P9` `P0` `PgDn` | `]` `P4` `P5` `P6` `+` `|` | `}` `P1` `P2` `P3` `-`; thumb area: `)`, `Delete`, `P0`.

**Raise (Fn2)** — left: `F12` `F1`–`F5` | `RGB Toggle` `!` `@` `#` `$` `%` | media (`Prev/Next Track`, `Vol±`, `Play/Stop/Mute`) + `PgUp/PgDn`; right: `F6`–`F11` | `^` `&` `*` `(` `)` `Boot` | `=` `Home` RGB Hue/Sat/Val± `\` | `+` `End` … `-`.

## 3. Reference mode

- Dedicated screen: the board rendered as **SVG from `layout.json`** — column stagger and rotated thumb keys faithful to the physical board; tabs (or `1`/`2`/`3` shortcuts) switch Base / Lower / Raise.
- **Char lookup:** type or click any character → every location that produces it glows across layers, with the recipe spelled out ("hold **Lower** + right index, home row" style).
- A collapsible **mini-map** of the same component is available inside every training screen, showing live hints (next expected char's key + required layer-hold glow).

## 4. Typing engine

- Custom typing pane; `keydown`-level capture (so named keys are trainable: Enter, Tab, Backspace, arrows, Home/End, PgUp/PgDn, F-keys, Esc — everything except media/RGB keys).
- Target text rendered with **Shiki** syntax highlighting; a cursor advances over it; per-keystroke green/red feedback.
- **Strict mode:** a wrong keystroke blocks advancement until corrected (Backspace works and is itself logged). No auto-anything.
- Whitespace policy: newlines are typed explicitly (`Enter`); **leading indentation is auto-skipped by default** (editors handle indentation in real life), with a "strict whitespace" toggle for purists.
- Every keystroke logs `(expected, got, correct, inter_key_latency_ms, skill_id, drill_id, session_id, ts)`.
- **Layer-chord latency** is the marquee metric: time-to-correct-keystroke for Lower/Raise-resident chars, tracked separately from base chars — it measures the hold-tap-release dance that actually makes coding slow.

## 5. Curriculum

Staged, mastery-gated (defaults: accuracy ≥ 96% AND median keystroke latency ≤ 400 ms across the stage's skills, both tunable in settings), free roam always allowed:

1. **Base refresh** — letters, base punctuation.
2. **Base shifted** — number row digits and `!@#$%^&*()` via Shift.
3. **Lower symbols** — `[ ] { } ( ) ~ ` + - | _` and friends: the coding core.
4. **Lower numpad** — P0–P9, arithmetic runs, digit-heavy code.
5. **Navigation** — arrows, Home/End, PgUp/PgDn via dedicated nav drills (keydown-verified).
6. **Per-language idiom drills** — short real lines dense in that language's syntax (`const xs = items.map((n) => n * 2);`, `WHERE created_at >= now() - interval '7 days'`).
7. **Code copy** — full snippets from the corpus, split view: target left, typing pane right.

## 6. Adaptive engine

- Per-skill **EWMA** of error rate and latency (separate α for each; latency uses median-of-recent seeding to resist outliers like coffee breaks — cap inter-key gaps at ~5 s before they enter the average).
- A **drill generator** composes practice lines weighted toward the weakest/slowest skills, embedding them in realistic contexts (symbols wrapped in code-ish fragments, not bare runs), keybr-style.
- Warmups in the daily session are generated this way, so practice automatically chases the worst layer-chords.
- Implemented in TS (pure functions, heavily unit-tested); raw events + aggregates persisted via Rust/SQLite.

## 7. Corpus

- Bundled JSON, per language: **JS, TS, HTML, CSS, PHP, Rust, Go, Java, Kotlin, SQL (Postgres)**.
- Per language: ~30 **idiom lines** (one-liners, tagged by the skills they exercise) + ~15 **snippets** (5–25 lines), graded `easy | medium | hard`, tagged with symbol-density and features (`closures`, `generics`, `cte`, `match`, `grid`…).
- Authored to be symbol-dense and idiomatic — match arms, CTEs, lifetimes, arrow chains, media queries — not hello-worlds.
- Format is stupid-simple so adding snippets later is a copy-paste job:

```jsonc
{ "lang": "rust", "kind": "idiom", "difficulty": "medium",
  "tags": ["match", "option"],
  "text": "let name = user.map(|u| u.name).unwrap_or_default();" }
```

## 8. Daily session, tray & reminders

- **Tray-resident**: autostarts at login hidden in the menu bar. Tray menu: Start Today's Session / Open keydrill / Remind me later ▸ (30 min · 1 hr · 6 hrs) / Quit.
- **Reminder**: at a configured hour, ONE notification per day: "Time to train." Snoozing (30 m / 1 h / 6 h) re-reminds after the chosen delay; completing today's session silences it for the day. macOS desktop notifications don't reliably support inline action buttons, so clicking the notification opens a small Start/Snooze window with the same choices.
- **Today's Session** (~10 min): adaptive warmup → weak-spot drills → one code-copy exercise in a language of choice (rotates by default, pinnable).
- **Streak**: counted on session completion; calendar view; no guilt mechanics beyond the streak itself.

## 9. Stats dashboard

- Streak + calendar.
- WPM and accuracy trends (overall and code-mode-only).
- Per-layer progress bars and the **layer-chord latency curve** over time.
- **Keyboard heatmap**: per-key error rate / slowness rendered directly on the SVG board map (reuses the reference component), switchable per layer.

## 10. Data model (SQLite, owned by Rust)

- `sessions(id, started_at, ended_at, mode, language, wpm, accuracy, completed)`
- `keystroke_events(id, session_id, ts, expected, got, correct, latency_ms, skill_id, drill_id)`
- `skills(id, layer, key_id, ewma_error, ewma_latency_ms, samples, updated_at)`
- `days(date, session_completed, reminder_fired_at, snoozed_until)`
- `settings(key, value)`
- Aggregations (trends, heatmap, curriculum gates) computed in Rust behind Tauri commands.

## 11. Testing

- **Vitest (`vp test`)**: diff/typing engine, reverse index + recipe policy, adaptive scheduler, drill generator, curriculum gating — all pure TS.
- **Rust unit tests**: stats store, EWMA aggregation, streak/reminder day-logic.
- **Playwright**: thin smoke suite against the built app shell (launches, reference map renders all three layers, a drill accepts keystrokes end-to-end).
- Layout correctness: the in-app **verification wizard** (§2) doubles as the acceptance test for `layout.json`.

## Out of scope (v1)

- Importing snippets from Mike's own repos (phase 2 candidate).
- Windows/Linux polish, cloud sync, multiple keyboard profiles (schema allows a second `layout.json` later).
- Detecting *which* physical route produced a multi-route char (OS can't tell us).
- Training media/RGB keys.

## Open questions

None blocking. Board model assumed Iris-class; geometry is data in `layout.json`, so correcting it is a data edit, not a code change.
