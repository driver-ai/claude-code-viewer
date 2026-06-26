import { describe, expect, it } from "vitest";
import type { ErrorJsonl, ExtendedConversation } from "../../types.ts";
import {
  type CursorParseContext,
  parseCursorAgentJsonl,
} from "./parseCursorAgentJsonl.ts";

type UserEntry = Extract<ExtendedConversation, { type: "user" }>;
type AssistantEntry = Extract<ExtendedConversation, { type: "assistant" }>;
type SystemEntry = Extract<ExtendedConversation, { type: "system" }>;

const expectUserEntry = (entry: ExtendedConversation | undefined): UserEntry => {
  expect(entry?.type).toBe("user");
  if (entry?.type !== "user") {
    throw new Error("Expected user entry");
  }
  return entry;
};

const expectAssistantEntry = (
  entry: ExtendedConversation | undefined,
): AssistantEntry => {
  expect(entry?.type).toBe("assistant");
  if (entry?.type !== "assistant") {
    throw new Error("Expected assistant entry");
  }
  return entry;
};

const expectSystemEntry = (
  entry: ExtendedConversation | undefined,
): SystemEntry => {
  expect(entry?.type).toBe("system");
  if (entry?.type !== "system") {
    throw new Error("Expected system entry");
  }
  return entry;
};

const expectErrorEntry = (entry: ExtendedConversation | undefined): ErrorJsonl => {
  expect(entry?.type).toBe("x-error");
  if (entry?.type !== "x-error") {
    throw new Error("Expected x-error entry");
  }
  return entry;
};

const defaultContext: CursorParseContext = {
  sessionId: "test-session-id",
  cwd: "/Users/fangio/Code/myapp",
  timestamp: "2026-06-26T10:00:00.000Z",
};

describe("parseCursorAgentJsonl", () => {
  it("with valid user line returns ExtendedConversation with type user and synthetic BaseEntrySchema fields", () => {
    const jsonl = JSON.stringify({
      role: "user",
      message: {
        content: [{ type: "text", text: "Hello from Cursor" }],
      },
    });

    const result = parseCursorAgentJsonl(jsonl, defaultContext);

    expect(result).toHaveLength(1);
    const entry = expectUserEntry(result[0]);

    // Synthetic BaseEntrySchema fields
    expect(entry.isSidechain).toBe(false);
    expect(entry.userType).toBe("external");
    expect(entry.cwd).toBe(defaultContext.cwd);
    expect(entry.sessionId).toBe(defaultContext.sessionId);
    expect(entry.version).toBe("cursor-agent-1.0");
    expect(entry.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(entry.timestamp).toBe(defaultContext.timestamp);
    expect(entry.parentUuid).toBeNull();

    // User message shape
    expect(entry.message.role).toBe("user");
    expect(entry.message.content).toEqual([
      { type: "text", text: "Hello from Cursor" },
    ]);
  });

  it("with valid assistant line containing tool_use returns type assistant with tool_use content blocks preserved", () => {
    const jsonl = JSON.stringify({
      role: "assistant",
      message: {
        content: [
          { type: "text", text: "I will help you." },
          {
            type: "tool_use",
            name: "read_file",
            input: { path: "/src/index.ts" },
            id: "tool-call-123",
          },
        ],
      },
    });

    const result = parseCursorAgentJsonl(jsonl, defaultContext);

    expect(result).toHaveLength(1);
    const entry = expectAssistantEntry(result[0]);

    // Synthetic assistant message fields
    expect(entry.message.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(entry.message.type).toBe("message");
    expect(entry.message.role).toBe("assistant");
    expect(entry.message.model).toBe("cursor-unknown");

    // Content blocks preserved
    expect(entry.message.content).toHaveLength(2);
    expect(entry.message.content[0]).toEqual({
      type: "text",
      text: "I will help you.",
    });
    expect(entry.message.content[1]).toMatchObject({
      type: "tool_use",
      name: "read_file",
      input: { path: "/src/index.ts" },
      id: "tool-call-123",
    });
  });

  it("with system role line returns type system entry with synthetic BaseEntrySchema fields", () => {
    const jsonl = JSON.stringify({
      role: "system",
      message: {
        content: [{ type: "text", text: "System instructions here" }],
      },
    });

    const result = parseCursorAgentJsonl(jsonl, defaultContext);

    expect(result).toHaveLength(1);
    const entry = expectSystemEntry(result[0]);

    // Synthetic BaseEntrySchema fields
    expect(entry.isSidechain).toBe(false);
    expect(entry.userType).toBe("external");
    expect(entry.cwd).toBe(defaultContext.cwd);
    expect(entry.sessionId).toBe(defaultContext.sessionId);
    expect(entry.version).toBe("cursor-agent-1.0");
    expect(entry.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(entry.timestamp).toBe(defaultContext.timestamp);
    expect(entry.parentUuid).toBeNull();
  });

  it("with turn_ended line drops it from output", () => {
    const jsonl = JSON.stringify({
      type: "turn_ended",
      status: "success",
    });

    const result = parseCursorAgentJsonl(jsonl, defaultContext);

    expect(result).toHaveLength(0);
  });

  it("with malformed JSON returns ErrorJsonl with line number", () => {
    const jsonl = "this is not valid json {{{";

    const result = parseCursorAgentJsonl(jsonl, defaultContext);

    expect(result).toHaveLength(1);
    const errorEntry = expectErrorEntry(result[0]);
    expect(errorEntry.type).toBe("x-error");
    expect(errorEntry.lineNumber).toBe(1);
    expect(errorEntry.line).toBe("this is not valid json {{{");
  });

  it("with mixed valid/invalid lines returns correct types and error entries interleaved", () => {
    const jsonl = [
      JSON.stringify({
        role: "user",
        message: {
          content: [{ type: "text", text: "Hello" }],
        },
      }),
      "not valid json",
      JSON.stringify({
        role: "assistant",
        message: {
          content: [{ type: "text", text: "Hi there" }],
        },
      }),
      JSON.stringify({ type: "unknown_garbage", foo: "bar" }),
    ].join("\n");

    const result = parseCursorAgentJsonl(jsonl, defaultContext);

    expect(result).toHaveLength(4);
    expect(result[0]?.type).toBe("user");
    expect(result[1]?.type).toBe("x-error");
    expect(result[2]?.type).toBe("assistant");
    expect(result[3]?.type).toBe("x-error");

    const errorEntry1 = expectErrorEntry(result[1]);
    expect(errorEntry1.lineNumber).toBe(2);

    const errorEntry2 = expectErrorEntry(result[3]);
    expect(errorEntry2.lineNumber).toBe(4);
  });

  it("with empty content returns empty array", () => {
    const result = parseCursorAgentJsonl("", defaultContext);

    expect(result).toEqual([]);
  });

  it("with multi-line content has correct parentUuid chain", () => {
    const jsonl = [
      JSON.stringify({
        role: "user",
        message: {
          content: [{ type: "text", text: "First message" }],
        },
      }),
      JSON.stringify({
        role: "assistant",
        message: {
          content: [{ type: "text", text: "Response" }],
        },
      }),
      JSON.stringify({
        role: "user",
        message: {
          content: [{ type: "text", text: "Follow-up" }],
        },
      }),
    ].join("\n");

    const result = parseCursorAgentJsonl(jsonl, defaultContext);

    expect(result).toHaveLength(3);

    const first = expectUserEntry(result[0]);
    const second = expectAssistantEntry(result[1]);
    const third = expectUserEntry(result[2]);

    // First entry has null parentUuid
    expect(first.parentUuid).toBeNull();

    // Second entry references first entry's uuid
    expect(second.parentUuid).toBe(first.uuid);

    // Third entry references second entry's uuid
    expect(third.parentUuid).toBe(second.uuid);
  });
});
