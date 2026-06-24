import { describe, expect, test } from "vitest";
import { LastPromptEntrySchema } from "./LastPromptEntrySchema.ts";

describe("LastPromptEntrySchema", () => {
  test("accepts valid last-prompt entry", () => {
    const result = LastPromptEntrySchema.safeParse({
      type: "last-prompt",
      lastPrompt: "Read docs/2026-03-12-phase-2-raise-only-hires.md...",
      sessionId: "28fc793f-fbe6-4062-8b4a-3d6e28f65b8b",
    });
    expect(result.success).toBe(true);
    const data = result.success ? result.data : undefined;
    expect(data?.type).toBe("last-prompt");
    expect(data?.lastPrompt).toBe("Read docs/2026-03-12-phase-2-raise-only-hires.md...");
    expect(data?.sessionId).toBe("28fc793f-fbe6-4062-8b4a-3d6e28f65b8b");
  });

  test("accepts last-prompt entry with leafUuid only", () => {
    const result = LastPromptEntrySchema.safeParse({
      type: "last-prompt",
      leafUuid: "59e75bfa-4896-4277-b3eb-acdabb3e18ab",
      sessionId: "c4f22d6f-a1c3-4c6d-bc0c-d579bba7c067",
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing lastPrompt and leafUuid", () => {
    const result = LastPromptEntrySchema.safeParse({
      type: "last-prompt",
      sessionId: "28fc793f-fbe6-4062-8b4a-3d6e28f65b8b",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing sessionId", () => {
    const result = LastPromptEntrySchema.safeParse({
      type: "last-prompt",
      lastPrompt: "Some prompt text",
    });
    expect(result.success).toBe(false);
  });

  test("rejects wrong type literal", () => {
    const result = LastPromptEntrySchema.safeParse({
      type: "not-last-prompt",
      lastPrompt: "Some prompt text",
      sessionId: "abc-123",
    });
    expect(result.success).toBe(false);
  });
});
