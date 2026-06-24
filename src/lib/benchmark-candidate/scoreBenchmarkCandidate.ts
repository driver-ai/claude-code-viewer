import type { ExtendedConversation } from "../../types/conversation.ts";
import { parseUserMessage } from "../claude-code/parseUserMessage.ts";

// ── constants ────────────────────────────────────────────────────────────────

const SEARCH_TOOL_NAMES = new Set(["Grep", "Glob"]);
const EDIT_TOOL_NAMES = new Set(["Write", "Edit", "StrReplace"]);

const BASH_SEARCH_PATTERN = /\b(find|grep|rg|ls)\b/;
const TEST_RUNNER_PATTERN =
  /\b(pytest|jest|vitest|go test|cargo test|pnpm test|npm test|yarn test|bun test|mocha|rspec)\b/;
const GIT_COMMIT_PUSH_PATTERN = /\bgit (commit|push)\b/;
const QUALITY_GATE_PATTERN = /\b(typecheck|gatecheck|lint|tsc)\b/;
const DRIVER_MCP_PATTERN = /^mcp__driver__/i;

// ── types ─────────────────────────────────────────────────────────────────────

export type BenchmarkSignals = {
  readonly distinctFilesRead: number;
  readonly searchToolCalls: number;
  readonly searchMisses: number;
  readonly reReadCount: number;
  readonly turnsToFirstEdit: number;
  readonly editFanOutDirs: number;
  readonly totalAssistantTurns: number;
  readonly testRunnerInvoked: boolean;
  readonly lastTestRunPassed: boolean;
  readonly hasCommitOrPush: boolean;
  readonly hasPrLink: boolean;
  readonly hasQualityGate: boolean;
  readonly hasCrispTaskStatement: boolean;
};

export type BenchmarkCandidateScore = {
  readonly contextDifficulty: number;
  readonly verifiability: number;
  readonly overall: "strong" | "possible" | "weak";
  readonly signals: BenchmarkSignals;
  readonly driverUsage: { readonly used: boolean; readonly toolCalls: number };
};

// ── helpers ───────────────────────────────────────────────────────────────────

const getFirstUserText = (conv: ExtendedConversation): string | null => {
  if (conv.type !== "user") return null;
  const { content } = conv.message;
  if (typeof content === "string") return content;
  const first = content.at(0);
  if (first === undefined) return null;
  if (typeof first === "string") return first;
  if (first.type === "text") return first.text;
  return null;
};

const getFilePath = (input: Record<string, unknown>): string | null => {
  const fp = input.file_path;
  return typeof fp === "string" ? fp : null;
};

const getDirFromPath = (filePath: string): string => {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash > 0 ? filePath.slice(0, lastSlash) : "/";
};

const extractTextFromResultItem = (r: unknown): string => {
  if (typeof r !== "object" || r === null) return "";
  if (!("type" in r) || r.type !== "text") return "";
  if (!("text" in r) || typeof r.text !== "string") return "";
  return r.text;
};

const getToolResultText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(extractTextFromResultItem).join("");
};

// ── scorer ────────────────────────────────────────────────────────────────────

export const scoreBenchmarkCandidate = (
  conversations: readonly ExtendedConversation[],
): BenchmarkCandidateScore => {
  const seenAssistantMessageIds = new Set<string>();
  const readFilePaths = new Map<string, number>();
  const editedDirs = new Set<string>();
  const searchToolUseIds = new Set<string>();
  const testRunnerToolUseIds: string[] = [];

  let driverToolCallCount = 0;
  let searchToolCalls = 0;
  let searchMisses = 0;
  let turnsToFirstEdit = 0;
  let foundFirstEdit = false;
  let hasCommitOrPush = false;
  let hasPrLink = false;
  let hasQualityGate = false;
  let testRunnerInvoked = false;
  let lastTestRunPassed = false;
  let hasCrispTaskStatement = false;

  for (const conv of conversations) {
    if (conv.type === "x-error") continue;

    if (conv.type === "pr-link") {
      hasPrLink = true;
      continue;
    }

    if (conv.type === "user") {
      const { content } = conv.message;

      // Detect crisp task statement from first meaningful plain-text user message
      if (!hasCrispTaskStatement && conv.isMeta !== true) {
        const text = getFirstUserText(conv);
        if (text !== null) {
          const parsed = parseUserMessage(text);
          if (parsed.kind === "text" && parsed.content.trim().length > 10) {
            hasCrispTaskStatement = true;
          }
        }
      }

      if (!Array.isArray(content)) continue;

      for (const item of content) {
        if (typeof item === "string" || item.type !== "tool_result") continue;

        const { tool_use_id, content: resultContent, is_error } = item;

        // Track last test runner result
        if (testRunnerToolUseIds.includes(tool_use_id)) {
          lastTestRunPassed = is_error !== true;
        }

        // Detect search misses
        if (searchToolUseIds.has(tool_use_id)) {
          const text = getToolResultText(resultContent);
          if (is_error === true || text.trim() === "" || text.includes("No files found")) {
            searchMisses++;
          }
        }
      }
      continue;
    }

    if (conv.type === "assistant") {
      const { message } = conv;
      const isNewTurn = !seenAssistantMessageIds.has(message.id);
      seenAssistantMessageIds.add(message.id);

      if (!Array.isArray(message.content)) continue;

      for (const item of message.content) {
        if (typeof item === "string" || item.type !== "tool_use") continue;

        const { name, input, id: toolUseId } = item;

        // Driver MCP detection
        if (DRIVER_MCP_PATTERN.test(name)) {
          driverToolCallCount++;
        }

        // Read tracking
        if (name === "Read") {
          const fp = getFilePath(input);
          if (fp !== null) {
            readFilePaths.set(fp, (readFilePaths.get(fp) ?? 0) + 1);
          }
        }

        // Search tool tracking
        if (SEARCH_TOOL_NAMES.has(name)) {
          searchToolCalls++;
          searchToolUseIds.add(toolUseId);
        }

        if (name === "Bash") {
          const command = typeof input.command === "string" ? input.command : "";

          if (BASH_SEARCH_PATTERN.test(command)) {
            searchToolCalls++;
            searchToolUseIds.add(toolUseId);
          }
          if (TEST_RUNNER_PATTERN.test(command)) {
            testRunnerInvoked = true;
            testRunnerToolUseIds.push(toolUseId);
          }
          if (GIT_COMMIT_PUSH_PATTERN.test(command)) {
            hasCommitOrPush = true;
          }
          if (QUALITY_GATE_PATTERN.test(command)) {
            hasQualityGate = true;
          }
        }

        // Edit tracking
        if (EDIT_TOOL_NAMES.has(name)) {
          foundFirstEdit = true;
          const fp = getFilePath(input);
          if (fp !== null) {
            editedDirs.add(getDirFromPath(fp));
          }
        }
      }

      // Count exploration turns before first edit (at message granularity)
      if (isNewTurn && !foundFirstEdit) {
        turnsToFirstEdit++;
      }
    }
  }

  // ── derived signals ───────────────────────────────────────────────────────

  const distinctFilesRead = readFilePaths.size;
  const reReadCount = [...readFilePaths.values()].filter((count) => count > 1).length;
  const editFanOutDirs = editedDirs.size;
  const totalAssistantTurns = seenAssistantMessageIds.size;

  const signals: BenchmarkSignals = {
    distinctFilesRead,
    searchToolCalls,
    searchMisses,
    reReadCount,
    turnsToFirstEdit,
    editFanOutDirs,
    totalAssistantTurns,
    testRunnerInvoked,
    lastTestRunPassed,
    hasCommitOrPush,
    hasPrLink,
    hasQualityGate,
    hasCrispTaskStatement,
  };

  // ── sub-scores ─────────────────────────────────────────────────────────────

  const contextDifficulty = Math.min(
    100,
    Math.min(25, distinctFilesRead * 5) + // 5+ distinct files → 25 pts
      Math.min(20, editFanOutDirs * 7) + // 3+ dirs edited  → 21 pts (capped at 20)
      Math.min(20, turnsToFirstEdit * 5) + // 4+ turns before edit → 20 pts
      Math.min(15, searchMisses * 5) + // 3+ search misses → 15 pts
      Math.min(10, reReadCount * 5) + // 2+ re-reads      → 10 pts
      Math.min(10, searchToolCalls * 2), // 5+ searches      → 10 pts
  );

  const verifiability = Math.min(
    100,
    (testRunnerInvoked ? 30 : 0) +
      (testRunnerInvoked && lastTestRunPassed ? 20 : 0) +
      (hasCommitOrPush ? 20 : 0) +
      (hasPrLink ? 10 : 0) +
      (hasQualityGate ? 10 : 0) +
      (hasCrispTaskStatement ? 10 : 0),
  );

  const overall: "strong" | "possible" | "weak" =
    contextDifficulty >= 60 && verifiability >= 60
      ? "strong"
      : contextDifficulty >= 35 || verifiability >= 40
        ? "possible"
        : "weak";

  return {
    contextDifficulty,
    verifiability,
    overall,
    signals,
    driverUsage: {
      used: driverToolCallCount > 0,
      toolCalls: driverToolCallCount,
    },
  };
};
