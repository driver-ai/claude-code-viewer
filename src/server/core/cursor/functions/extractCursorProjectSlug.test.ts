import { describe, expect, test } from "vitest";
import { extractCursorProjectSlug } from "./extractCursorProjectSlug.ts";

describe("extractCursorProjectSlug", () => {
  test("extracts project slug from a standard cursor agent-transcripts path", () => {
    const path = "~/.cursor/projects/Users-fangio-Code-myapp/agent-transcripts/uuid/uuid.jsonl";
    expect(extractCursorProjectSlug(path)).toBe("Users-fangio-Code-myapp");
  });

  test("returns 'unknown-project' when path has no agent-transcripts segment", () => {
    const path = "~/.cursor/projects/Users-fangio-Code-myapp/some-other/file.jsonl";
    expect(extractCursorProjectSlug(path)).toBe("unknown-project");
  });

  test("returns 'unknown-project' when agent-transcripts is at position 0 with no preceding segment", () => {
    const path = "agent-transcripts/uuid/uuid.jsonl";
    expect(extractCursorProjectSlug(path)).toBe("unknown-project");
  });
});
