import { describe, expect, it } from "vite-plus/test";
import type { DrillSummary } from "../engine/metrics";
import type { KeystrokeLog } from "../engine/typing-reducer";
import { createTauriBackend, type InvokeFn } from "./tauri";

function recordingInvoke(returns: Record<string, unknown> = {}): {
  calls: Array<{ cmd: string; args: Record<string, unknown> | undefined }>;
  invoke: InvokeFn;
} {
  const calls: Array<{ cmd: string; args: Record<string, unknown> | undefined }> = [];
  const invoke = (<T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ cmd, args });
    return Promise.resolve((returns[cmd] ?? null) as T);
  }) as InvokeFn;
  return { calls, invoke };
}

const SUMMARY: DrillSummary = {
  wpm: 40,
  accuracy: 0.95,
  durationMs: 30000,
  keystrokes: 100,
  errors: 5,
  layerLatencyMs: 400,
  baseLatencyMs: 200,
};

const LOG: KeystrokeLog = {
  ts: 1,
  expected: "{",
  got: "{",
  correct: true,
  latencyMs: 300,
  skillId: "lower:L35",
};

describe("createTauriBackend", () => {
  it("startSession invokes start_session with mode and language", async () => {
    const { calls, invoke } = recordingInvoke({
      start_session: { id: "s1", mode: "drill", language: null, startedAt: 5 },
    });
    const meta = await createTauriBackend(invoke).startSession("drill", null);
    expect(calls).toEqual([{ cmd: "start_session", args: { mode: "drill", language: null } }]);
    expect(meta.id).toBe("s1");
  });

  it("ingestKeystrokes invokes ingest_keystrokes with sessionId and logs", async () => {
    const { calls, invoke } = recordingInvoke();
    await createTauriBackend(invoke).ingestKeystrokes("s1", [LOG]);
    expect(calls).toEqual([{ cmd: "ingest_keystrokes", args: { sessionId: "s1", logs: [LOG] } }]);
  });

  it("endSession invokes end_session with summary and completion flag", async () => {
    const { calls, invoke } = recordingInvoke();
    await createTauriBackend(invoke).endSession("s1", SUMMARY, true);
    expect(calls).toEqual([
      {
        cmd: "end_session",
        args: { sessionId: "s1", summary: SUMMARY, completedDailySession: true },
      },
    ]);
  });

  it("read methods invoke their commands with the right payloads", async () => {
    const { calls, invoke } = recordingInvoke({
      get_skill_stats: [],
      get_trends: [],
      get_heatmap: [],
      get_day_state: { date: "2026-08-20", sessionCompleted: false, streak: 0 },
      get_setting: null,
    });
    const b = createTauriBackend(invoke);
    await b.getSkillStats();
    await b.getTrends(14);
    await b.getHeatmap("lower");
    await b.getDayState();
    await b.getSetting("reminder.hour");
    await b.setSetting("reminder.hour", "9");
    expect(calls.map((c) => c.cmd)).toEqual([
      "get_skill_stats",
      "get_trends",
      "get_heatmap",
      "get_day_state",
      "get_setting",
      "set_setting",
    ]);
    expect(calls[1].args).toEqual({ days: 14 });
    expect(calls[2].args).toEqual({ layer: "lower" });
    expect(calls[4].args).toEqual({ key: "reminder.hour" });
    expect(calls[5].args).toEqual({ key: "reminder.hour", value: "9" });
  });
});
