import type { ExtendedConversation } from "../../types/conversation.ts";
import { parseUserMessage } from "../claude-code/parseUserMessage.ts";

// ── constants ────────────────────────────────────────────────────────────────

const SEARCH_TOOL_NAMES = new Set(["Grep", "Glob", "rg", "SemanticSearch"]);
const EDIT_TOOL_NAMES = new Set(["Write", "Edit", "StrReplace", "ApplyPatch"]);

const BASH_SEARCH_PATTERN = /\b(find|grep|rg|ls)\b/;
const TEST_RUNNER_PATTERN =
  /\b(pytest|jest|vitest|go test|cargo test|pnpm test|npm test|yarn test|bun test|mocha|rspec)\b/;
const GIT_COMMIT_PUSH_PATTERN = /\bgit (commit|push)\b/;
const QUALITY_GATE_PATTERN = /\b(typecheck|gatecheck|lint|tsc)\b/;
const GIT_COMMIT_ONLY_PATTERN = /\bgit commit\b/;
const DRIVER_MCP_TOOL_NAMES = new Set([
  "fetch_registered_content",
  "gather_task_context",
  "get_architecture_overview",
  "get_branches",
  "get_changelog",
  "get_code_map",
  "get_codebase_names",
  "get_detailed_changelog",
  "get_file_documentation",
  "get_llm_onboarding_guide",
  "get_registered_content_list",
  "get_source_file",
  "register_content",
  "remove_registered_content",
]);

const getDriverMcpToolName = (toolCallName: string): string | null => {
  const match = toolCallName.match(/^mcp__[^_]+__(.+)$/);
  if (match === null) return null;
  const suffix = match[1] ?? null;
  if (suffix === null) return null;
  return DRIVER_MCP_TOOL_NAMES.has(suffix) ? suffix : null;
};

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
  readonly commitCount: number;
  readonly promptCycleCount: number;
  readonly sessionDurationMinutes: number;
};

export type DriverToolBreakdown = {
  readonly used: boolean;
  readonly totalCalls: number;
  readonly toolCounts: Readonly<Record<string, number>>;
};

export type FileReadDetail = {
  readonly path: string;
  readonly count: number;
};

export type BenchmarkCandidateScore = {
  readonly contextDifficulty: number;
  readonly verifiability: number;
  readonly overall: "strong" | "possible" | "weak";
  readonly signals: BenchmarkSignals;
  readonly driverToolBreakdown: DriverToolBreakdown;
  readonly fileReadDetails: readonly FileReadDetail[];
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
  const fp = input.file_path ?? input.path;
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

  const driverToolCounts: Record<string, number> = {};
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
  let commitCount = 0;
  let promptCycleCount = 0;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  for (const conv of conversations) {
    if (conv.type === "x-error") continue;

    // Track timestamps for session duration (all non-error entries have timestamp)
    if ("timestamp" in conv && typeof conv.timestamp === "string") {
      firstTimestamp ??= conv.timestamp;
      lastTimestamp = conv.timestamp;
    }

    if (conv.type === "pr-link") {
      hasPrLink = true;
      continue;
    }

    if (conv.type === "user") {
      // Count prompt cycles: each root user message that is NOT purely tool results
      // starts a new prompt cycle (tool_result entries are continuations, not new prompts)
      if (conv.parentUuid === null) {
        const { content } = conv.message;
        const isPureToolResult =
          Array.isArray(content) &&
          content.length > 0 &&
          content.every(
            (item) =>
              typeof item !== "string" && typeof item === "object" && item.type === "tool_result",
          );
        if (!isPureToolResult) {
          promptCycleCount++;
        }
      }

      const { content } = conv.message;

      // Detect crisp task statement from first meaningful plain-text user message
      if (!hasCrispTaskStatement && conv.isMeta !== true) {
        const text = getFirstUserText(conv);
        if (text !== null) {
          const trimmed = text.trim();
          // Skip IDE context injections, empty/short messages
          if (!trimmed.startsWith("<ide_") && trimmed.length > 10) {
            const parsed = parseUserMessage(text);
            if (parsed.kind === "text") {
              hasCrispTaskStatement = true;
            }
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

        // Driver MCP detection — match by known tool names, not server prefix
        const driverTool = getDriverMcpToolName(name);
        if (driverTool !== null) {
          driverToolCounts[driverTool] = (driverToolCounts[driverTool] ?? 0) + 1;
        }

        // Read tracking (Claude Code: "Read", Cursor: "Read" or "ReadFile")
        if (name === "Read" || name === "ReadFile") {
          const fp = getFilePath(input);
          if (fp !== null) {
            readFilePaths.set(fp, (readFilePaths.get(fp) ?? 0) + 1);
          }
        }

        // Search tool tracking (Cursor also uses "rg", "SemanticSearch")
        if (SEARCH_TOOL_NAMES.has(name)) {
          searchToolCalls++;
          searchToolUseIds.add(toolUseId);
        }

        // Shell command analysis (Claude Code: "Bash", Cursor: "Shell")
        if (name === "Bash" || name === "Shell") {
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
          if (GIT_COMMIT_ONLY_PATTERN.test(command)) {
            commitCount++;
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
    commitCount,
    promptCycleCount,
    sessionDurationMinutes:
      firstTimestamp !== null && lastTimestamp !== null
        ? (Date.parse(lastTimestamp) - Date.parse(firstTimestamp)) / 60000
        : 0,
  };

  // ── sub-scores ─────────────────────────────────────────────────────────────

  let contextDifficulty = Math.min(
    100,
    Math.min(25, distinctFilesRead * 5) + // 5+ distinct files → 25 pts
      Math.min(20, editFanOutDirs * 7) + // 3+ dirs edited  → 21 pts (capped at 20)
      Math.min(20, turnsToFirstEdit * 5) + // 4+ turns before edit → 20 pts
      Math.min(15, searchMisses * 5) + // 3+ search misses → 15 pts
      Math.min(10, reReadCount * 5) + // 2+ re-reads      → 10 pts
      Math.min(10, searchToolCalls * 2), // 5+ searches      → 10 pts
  );

  // ── isolatability penalties ────────────────────────────────────────────────

  if (commitCount > 3) {
    contextDifficulty = Math.max(0, contextDifficulty - Math.min(20, (commitCount - 3) * 5));
  }
  if (promptCycleCount > 5) {
    contextDifficulty = Math.max(0, contextDifficulty - Math.min(15, (promptCycleCount - 5) * 3));
  }

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

  const driverTotalCalls = Object.values(driverToolCounts).reduce((sum, c) => sum + c, 0);

  const fileReadDetails: FileReadDetail[] = [...readFilePaths.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count);

  return {
    contextDifficulty,
    verifiability,
    overall,
    signals,
    driverToolBreakdown: {
      used: driverTotalCalls > 0,
      totalCalls: driverTotalCalls,
      toolCounts: driverToolCounts,
    },
    fileReadDetails,
  };
};
