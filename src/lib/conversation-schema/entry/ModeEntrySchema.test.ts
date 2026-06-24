import { describe, expect, test } from "vitest";
import { ModeEntrySchema } from "./ModeEntrySchema.ts";

describe("ModeEntrySchema", () => {
  test("accepts valid mode entry", () => {
    const result = ModeEntrySchema.safeParse({
      type: "mode",
      mode: "normal",
      sessionId: "c4f22d6f-a1c3-4c6d-bc0c-d579bba7c067",
    });
    expect(result.success).toBe(true);
    const data = result.success ? result.data : undefined;
    expect(data?.type).toBe("mode");
    expect(data?.mode).toBe("normal");
    expect(data?.sessionId).toBe("c4f22d6f-a1c3-4c6d-bc0c-d579bba7c067");
  });

  test("rejects missing mode", () => {
    const result = ModeEntrySchema.safeParse({
      type: "mode",
      sessionId: "c4f22d6f-a1c3-4c6d-bc0c-d579bba7c067",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing sessionId", () => {
    const result = ModeEntrySchema.safeParse({
      type: "mode",
      mode: "normal",
    });
    expect(result.success).toBe(false);
  });

  test("rejects wrong type", () => {
    const result = ModeEntrySchema.safeParse({
      type: "permission-mode",
      mode: "normal",
      sessionId: "c4f22d6f-a1c3-4c6d-bc0c-d579bba7c067",
    });
    expect(result.success).toBe(false);
  });
});
