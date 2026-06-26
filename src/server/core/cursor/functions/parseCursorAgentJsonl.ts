import { ConversationSchema } from "../../../../lib/conversation-schema/index.ts";
import type { ErrorJsonl, ExtendedConversation } from "../../types.ts";
import {
  CursorAgentLineSchema,
  type CursorContentBlock,
  type CursorMessageLine,
} from "../schema.ts";

export type CursorParseContext = {
  sessionId: string;
  cwd: string;
  timestamp: string;
};

const mapContentBlocks = (
  blocks: CursorContentBlock[],
  role: "user" | "assistant" | "system",
): CursorContentBlock[] => {
  if (role !== "assistant") return blocks;
  return blocks.map((block) => {
    if (block.type === "tool_use" && (block.id === undefined || block.id === "")) {
      return { ...block, id: crypto.randomUUID() };
    }
    return block;
  });
};

const buildBaseFields = (context: CursorParseContext, parentUuid: string | null) => {
  const uuid = crypto.randomUUID();
  return {
    uuid,
    parentUuid,
    sessionId: context.sessionId,
    cwd: context.cwd,
    timestamp: context.timestamp,
    isSidechain: false,
    userType: "external" as const,
    version: "cursor-agent-1.0",
  };
};

const buildUserEntry = (
  line: CursorMessageLine,
  context: CursorParseContext,
  parentUuid: string | null,
) => {
  const base = buildBaseFields(context, parentUuid);
  return {
    ...base,
    type: "user" as const,
    message: {
      role: "user" as const,
      content: mapContentBlocks(line.message.content, "user"),
    },
  };
};

const buildAssistantEntry = (
  line: CursorMessageLine,
  context: CursorParseContext,
  parentUuid: string | null,
) => {
  const base = buildBaseFields(context, parentUuid);
  return {
    ...base,
    type: "assistant" as const,
    message: {
      id: crypto.randomUUID(),
      type: "message" as const,
      role: "assistant" as const,
      model: "cursor-unknown",
      content: mapContentBlocks(line.message.content, "assistant"),
      stop_reason: null,
    },
  };
};

const buildSystemEntry = (
  line: CursorMessageLine,
  context: CursorParseContext,
  parentUuid: string | null,
) => {
  const base = buildBaseFields(context, parentUuid);
  const textParts = line.message.content
    .filter((b) => b.type === "text" && b.text !== undefined)
    .map((b) => b.text)
    .join("\n");
  return {
    ...base,
    type: "system" as const,
    subtype: "informational" as const,
    content: textParts,
  };
};

const makeError = (line: string, lineNumber: number): ErrorJsonl => ({
  type: "x-error",
  line,
  lineNumber,
});

const extractUuid = (entry: ExtendedConversation): string | null => {
  if ("uuid" in entry && typeof entry.uuid === "string") {
    return entry.uuid;
  }
  return null;
};

export const parseCursorAgentJsonl = (
  content: string,
  context: CursorParseContext,
): ExtendedConversation[] => {
  const trimmed = content.trim();
  if (trimmed === "") return [];

  const lines = trimmed.split("\n").filter((line) => line.trim() !== "");
  const results: ExtendedConversation[] = [];
  let lastUuid: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Try to parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      results.push(makeError(line, i + 1));
      continue;
    }

    // Validate against Cursor schema
    const cursorResult = CursorAgentLineSchema.safeParse(parsed);
    if (!cursorResult.success) {
      results.push(makeError(line, i + 1));
      continue;
    }

    const cursorLine = cursorResult.data;

    // Drop turn_ended lines
    if ("type" in cursorLine && cursorLine.type === "turn_ended") {
      continue;
    }

    // Build the appropriate entry based on role
    if (!("role" in cursorLine)) continue;

    let rawEntry: Record<string, unknown>;
    switch (cursorLine.role) {
      case "user":
        rawEntry = buildUserEntry(cursorLine, context, lastUuid);
        break;
      case "assistant":
        rawEntry = buildAssistantEntry(cursorLine, context, lastUuid);
        break;
      case "system":
        rawEntry = buildSystemEntry(cursorLine, context, lastUuid);
        break;
      default:
        results.push(makeError(line, i + 1));
        continue;
    }

    // Validate against ConversationSchema
    const convResult = ConversationSchema.safeParse(rawEntry);
    if (!convResult.success) {
      results.push(makeError(line, i + 1));
      continue;
    }

    lastUuid = extractUuid(convResult.data);
    results.push(convResult.data);
  }

  return results;
};
