import raw from "./layout.json";
import type { Layout } from "./types";

/**
 * Board: Keebio Iris Rev. 8 running the stock QMK default keymap — confirmed
 * electronically 2026-09-07 over USB (idVendor 0xCB10 "Keebio", product
 * "Iris Rev. 8"). The rev8 shared default keymap
 * (qmk_firmware: keyboards/keebio/iris/keymaps/default/keymap.json) is
 * keycode-for-keycode identical to iris_ce/keymaps/default/keymap.c, which the
 * printed keymap card and board photos match 1:1. The firmware source resolved
 * every earlier transcription doubt:
 *  - L12 lower = ArrowUp (KC_UP) — confirmed.
 *  - L25 raise = '_' (KC_UNDS) — the unreadable card glyph; the underscore route
 *    is Raise+G, so no shifted-lower chord modelling is needed.
 *  - L35 raise = '-' (KC_MINS) — confirmed.
 *  - Lower right hand: '-' is on R34 (KC_MINS on the '/' key) and R35 (right
 *    Shift) is transparent — previously modelled one key off.
 *  - Right thumb stack lower: ')' on End (KC_RPRN), Delete on Space (KC_DEL) —
 *    confirmed; RT1 lower '0' (KC_P0) duplicates R14's P0, both real.
 *  - L00 is QK_GESC (Grave-Escape): tap = Escape, Shift+tap = '~' (modelled as
 *    base shift); GUI+tap = '`' is NOT modelled (Cmd chords are outside the
 *    training vocabulary).
 *  - EE_CLR lives on Lower+Z (L31) and Raise+RShift (R35) — untrainable system
 *    keys, shown for completeness.
 *  - Lower-layer transparent keys (QMK KC_TRNS) fall through to the base output;
 *    they are modelled as no-output since the fall-through routes add nothing.
 * If the keymap is ever changed in VIA, re-run the in-app verification wizard.
 */
export const LAYOUT: Layout = raw as unknown as Layout;
