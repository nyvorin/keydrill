import raw from "./layout.json";
import type { Layout } from "./types";

/**
 * Board data transcribed from the layout-card photo. Open transcription doubts —
 * the Task 19 verification wizard is the authority for correcting any of these:
 *  - L12 `lower` = ArrowUp: the card shows ↑ between ` and Boot; the column it belongs to is inferred.
 *  - L25 `raise`: the card legend is unreadable ('–'), so no raise output is modelled for this key.
 *  - L35 `raise` = '-': the card glyph is ambiguous between a minus sign and a blank.
 *  - RT1 `lower` = '0' duplicates R14's P0; both are modelled, both are separate skills.
 *  - '_' has NO modelled route: `-` exists only as `lower:R35` and `raise:L35`, and
 *    `KeyOutput.shift` is base-only, so the underscore (probably Shift+Lower+R35 on the
 *    real firmware) is unreachable. Spec §5 stage 3 lists it and the Task 10 corpus is
 *    full of it (`split_whitespace`, `user_id`), so the MiniMap will hint "no recipe"
 *    until the Task 19 wizard confirms the chord; if it does, model shift variants on
 *    the lower layer so `stageSkills(3)` can drill it.
 */
export const LAYOUT: Layout = raw as unknown as Layout;
