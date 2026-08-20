export interface TargetChar {
  ch: string;
  index: number;
  autoSkip: boolean;
}

const INDENT_CHARS = new Set([" ", "\t"]);

/**
 * Expands drill text into one TargetChar per UTF-16 code unit (corpus + layout are ASCII, so
 * `index` is also the string index — TypingPane relies on that to align shiki colors).
 * '\n' stays in the target and is satisfied by the Enter key (see expectedKeyFor).
 * Leading indentation is marked autoSkip unless the caller asked for strict whitespace.
 */
export function prepareTarget(text: string, opts: { strictWhitespace: boolean }): TargetChar[] {
  const out: TargetChar[] = [];
  let atLineStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // Annotated: `isIndent` feeds `atLineStart`, which it also reads — inference would be circular.
    const isIndent: boolean = atLineStart && INDENT_CHARS.has(ch);
    out.push({ ch, index: i, autoSkip: isIndent && !opts.strictWhitespace });
    atLineStart = ch === "\n" ? true : isIndent;
  }
  return out;
}

/**
 * Target for a navigation drill: each entry is a KeyboardEvent.key NAME
 * ('ArrowLeft', 'Home', 'PageUp'…) rather than a printable character.
 * Nothing is auto-skippable — every named key must actually be pressed.
 * `expectedKeyFor` passes named keys through unchanged, so the reducer,
 * the metrics and the skill lookup all work without a special case.
 */
export function prepareNavTarget(keys: string[]): TargetChar[] {
  return keys.map((ch, index) => ({ ch, index, autoSkip: false }));
}
