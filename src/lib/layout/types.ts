export type LayerId = "base" | "lower" | "raise";
export type Hand = "left" | "right";
export type Finger = "pinky" | "ring" | "middle" | "index" | "thumb";

export interface KeyOutput {
  /** printable result of a tap (unshifted) */
  char?: string;
  /** printable result with Shift held (base layer only) */
  shift?: string;
  /** named key: 'Enter' | 'Escape' | 'Tab' | 'Backspace' | 'Delete' | 'Home' | 'End' | 'PageUp' | 'PageDown' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'F1'..'F12'. Space is a char, not a key. */
  key?: string;
  /** modifier: Shift/Ctrl/Cmd/Alt/Lower/Raise; system: Boot/RGB/media (untrainable) */
  role?: "modifier" | "system";
}

export interface KeyDef {
  id: string;
  hand: Hand;
  row: number;
  col: number;
  /** 1u grid units */
  x: number;
  y: number;
  /** degrees clockwise */
  rot?: number;
  finger: Finger;
  legends: Partial<Record<LayerId, string>>;
  output: Partial<Record<LayerId, KeyOutput>>;
}

export interface Layout {
  board: string;
  keys: KeyDef[];
}
