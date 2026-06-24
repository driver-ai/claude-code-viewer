import { beforeEach, describe, expect, test } from "vitest";
import type { ExtendedConversation } from "../../types/conversation";
import { scoreBenchmarkCandidate } from "./scoreBenchmarkCandidate";

// ── test helpers ────────────────────────────────────────────────────────────

let _counter = 0;
const nextId = () => `id-${++_counter}`;
const nextMsgId = () => `msg-${++_counter}`;
const nextUuid = () => `00000000-0000-0000-0000-${String(++_counter).padStart(12, "0")}`;

beforeEach(() => {
  _counter = 0;
});

const baseEntry = {
  isSidechain: false,
  userType: "external" as const,
  cwd: "/projects/my-app",
  sessionId: "test-session-id",
  version: "1.0.0",
  parentUuid: null,
  timestamp: "2025-01-01T00:00:00Z",
};

type ToolUseSpec = { id: string; name: string; input: Record<string, unknown> };

const makeAssistantEntry = (toolUses: readonly ToolUseSpec[]): ExtendedConversation => ({
  ...baseEntry,
  uuid: nextUuid(),
  type: "assistant",
  message: {
    id: nextMsgId(),
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-20250514",
    content: toolUses.map((tu) => ({
      type: "tool_use" as const,
      id: tu.id,
      name: tu.name,
      input: tu.input,
    })),
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  },
});

const makeToolResultEntry = (
  toolUseId: string,
  content: string,
  isError = false,
): ExtendedConversation => ({
  ...baseEntry,
  uuid: nextUuid(),
  type: "user",
  message: {
    role: "user",
    content: [{ type: "tool_result" as const, tool_use_id: toolUseId, content, is_error: isError }],
  },
});

const makeUserTextEntry = (text: string): ExtendedConversation => ({
  ...baseEntry,
  uuid: nextUuid(),
  type: "user",
  message: {
    role: "user",
    content: [{ type: "text" as const, text }],
  },
});

const makePrLinkEntry = (): ExtendedConversation => ({
  type: "pr-link",
  sessionId: "test-session-id",
  prNumber: 42,
  prUrl: "https://github.com/example/repo/pull/42",
  prRepository: "example/repo",
  timestamp: "2025-01-01T00:00:00.000Z",
});

// ── tests ────────────────────────────────────────────────────────────────────

describe("scoreBenchmarkCandidate", () => {
  test("empty conversations → weak score with zeroed signals", () => {
    const result = scoreBenchmarkCandidate([]);
    expect(result.overall).toBe("weak");
    expect(result.contextDifficulty).toBe(0);
    expect(result.verifiability).toBe(0);
    expect(result.signals.distinctFilesRead).toBe(0);
    expect(result.signals.searchToolCalls).toBe(0);
    expect(result.signals.searchMisses).toBe(0);
    expect(result.signals.reReadCount).toBe(0);
    expect(result.signals.turnsToFirstEdit).toBe(0);
    expect(result.signals.editFanOutDirs).toBe(0);
    expect(result.signals.totalAssistantTurns).toBe(0);
    expect(result.signals.testRunnerInvoked).toBe(false);
    expect(result.signals.lastTestRunPassed).toBe(false);
    expect(result.signals.hasCommitOrPush).toBe(false);
    expect(result.signals.hasPrLink).toBe(false);
    expect(result.signals.hasQualityGate).toBe(false);
    expect(result.driverToolBreakdown.used).toBe(false);
    expect(result.driverToolBreakdown.totalCalls).toBe(0);
    expect(result.driverToolBreakdown.toolCounts).toEqual({});
  });

  test("trivial one-shot: one read then one write in a single turn → weak", () => {
    const tuRead = nextId();
    const tuWrite = nextId();
    const conversations: readonly ExtendedConversation[] = [
      makeAssistantEntry([
        { id: tuRead, name: "Read", input: { file_path: "/src/foo.ts" } },
        { id: tuWrite, name: "Write", input: { file_path: "/src/foo.ts" } },
      ]),
    ];
    const result = scoreBenchmarkCandidate(conversations);
    expect(result.overall).toBe("weak");
    expect(result.signals.distinctFilesRead).toBe(1);
    expect(result.signals.editFanOutDirs).toBe(1);
    expect(result.signals.turnsToFirstEdit).toBe(0);
  });

  test("high context difficulty: many reads, search misses, re-reads, multi-turn before edit", () => {
    const tu1 = nextId(); // Read /src/a.ts
    const tu2 = nextId(); // Read /src/b.ts
    const tu3 = nextId(); // Read /src/c.ts
    const tu4 = nextId(); // Grep → miss
    const tu5 = nextId(); // Read /src/d.ts
    const tu6 = nextId(); // Glob → miss (empty)
    const tu7 = nextId(); // Read /src/a.ts (re-read)
    const tu8 = nextId(); // Read /src/e.ts
    const tu9 = nextId(); // Read /src/f.ts
    const tu10 = nextId(); // Write /src/components/A.ts
    const tu11 = nextId(); // Write /src/utils/B.ts
    const tu12 = nextId(); // Write /tests/A.test.ts

    const conversations: readonly ExtendedConversation[] = [
      // Turn 1 – reads + grep miss
      makeAssistantEntry([
        { id: tu1, name: "Read", input: { file_path: "/src/a.ts" } },
        { id: tu2, name: "Read", input: { file_path: "/src/b.ts" } },
        { id: tu3, name: "Read", input: { file_path: "/src/c.ts" } },
        { id: tu4, name: "Grep", input: { pattern: "missingSymbol" } },
      ]),
      makeToolResultEntry(tu1, "export const a = 1;"),
      makeToolResultEntry(tu2, "export const b = 2;"),
      makeToolResultEntry(tu3, "export const c = 3;"),
      makeToolResultEntry(tu4, "No files found"),

      // Turn 2 – more reads + glob miss + re-read of /src/a.ts
      makeAssistantEntry([
        { id: tu5, name: "Read", input: { file_path: "/src/d.ts" } },
        { id: tu6, name: "Glob", input: { pattern: "*.test.ts" } },
        { id: tu7, name: "Read", input: { file_path: "/src/a.ts" } },
      ]),
      makeToolResultEntry(tu5, "export const d = 4;"),
      makeToolResultEntry(tu6, ""),
      makeToolResultEntry(tu7, "export const a = 1;"),

      // Turn 3 – more reads
      makeAssistantEntry([
        { id: tu8, name: "Read", input: { file_path: "/src/e.ts" } },
        { id: tu9, name: "Read", input: { file_path: "/src/f.ts" } },
      ]),
      makeToolResultEntry(tu8, "content e"),
      makeToolResultEntry(tu9, "content f"),

      // Turn 4 – edits across 3 distinct directories
      makeAssistantEntry([
        { id: tu10, name: "Write", input: { file_path: "/src/components/A.ts" } },
        { id: tu11, name: "Write", input: { file_path: "/src/utils/B.ts" } },
        { id: tu12, name: "Write", input: { file_path: "/tests/A.test.ts" } },
      ]),
    ];

    const result = scoreBenchmarkCandidate(conversations);

    expect(result.signals.distinctFilesRead).toBe(6); // a,b,c,d,e,f
    expect(result.signals.reReadCount).toBe(1); // /src/a.ts read twice
    expect(result.signals.searchMisses).toBe(2); // grep miss + glob empty
    expect(result.signals.turnsToFirstEdit).toBe(3); // turns 1,2,3 before turn 4 edits
    expect(result.signals.editFanOutDirs).toBe(3); // components, utils, tests
    expect(result.contextDifficulty).toBeGreaterThanOrEqual(60);
  });

  test("high verifiability: test run passes + commit + PR link + quality gate", () => {
    const tuTest = nextId();
    const tuCommit = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeUserTextEntry("Fix the authentication bug in the login flow"),
      makeAssistantEntry([{ id: tuTest, name: "Bash", input: { command: "vitest --run" } }]),
      makeToolResultEntry(tuTest, "All 42 tests passed", false),
      makeAssistantEntry([
        { id: tuCommit, name: "Bash", input: { command: "git commit -m 'fix: auth login flow'" } },
      ]),
      makeToolResultEntry(tuCommit, "[main abc1234] fix: auth login flow", false),
      makePrLinkEntry(),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.testRunnerInvoked).toBe(true);
    expect(result.signals.lastTestRunPassed).toBe(true);
    expect(result.signals.hasCommitOrPush).toBe(true);
    expect(result.signals.hasPrLink).toBe(true);
    expect(result.signals.hasCrispTaskStatement).toBe(true);
    expect(result.verifiability).toBeGreaterThanOrEqual(60);
  });

  test("strong candidate: high on both context-difficulty and verifiability", () => {
    const tu1 = nextId();
    const tu2 = nextId();
    const tu3 = nextId();
    const tu4 = nextId(); // Grep miss
    const tu5 = nextId();
    const tu6 = nextId();
    const tu7 = nextId(); // Glob miss
    const tu8 = nextId(); // Write
    const tu9 = nextId(); // Write
    const tu10 = nextId(); // Write
    const tu11 = nextId(); // vitest
    const tu12 = nextId(); // git commit

    const conversations: readonly ExtendedConversation[] = [
      makeUserTextEntry("Add user authentication to the API following the existing patterns"),

      // Turn 1: exploration with miss
      makeAssistantEntry([
        { id: tu1, name: "Read", input: { file_path: "/src/routes/users.ts" } },
        { id: tu2, name: "Read", input: { file_path: "/src/middleware/auth.ts" } },
        { id: tu3, name: "Read", input: { file_path: "/src/types/user.ts" } },
        { id: tu4, name: "Grep", input: { pattern: "authToken" } },
      ]),
      makeToolResultEntry(tu1, "router content"),
      makeToolResultEntry(tu2, "middleware content"),
      makeToolResultEntry(tu3, "type content"),
      makeToolResultEntry(tu4, "No files found"),

      // Turn 2: more exploration with miss
      makeAssistantEntry([
        { id: tu5, name: "Read", input: { file_path: "/src/db/schema.ts" } },
        { id: tu6, name: "Read", input: { file_path: "/src/config/index.ts" } },
        { id: tu7, name: "Glob", input: { pattern: "*.test.ts" } },
      ]),
      makeToolResultEntry(tu5, "schema content"),
      makeToolResultEntry(tu6, "config content"),
      makeToolResultEntry(tu7, ""),

      // Turn 3: edits across distinct dirs
      makeAssistantEntry([
        { id: tu8, name: "Write", input: { file_path: "/src/routes/auth.ts" } },
        { id: tu9, name: "Write", input: { file_path: "/src/middleware/verifyToken.ts" } },
        { id: tu10, name: "Write", input: { file_path: "/tests/auth.test.ts" } },
      ]),

      // Turn 4: tests pass
      makeAssistantEntry([{ id: tu11, name: "Bash", input: { command: "pnpm test" } }]),
      makeToolResultEntry(tu11, "All tests passed", false),

      // Turn 5: commit
      makeAssistantEntry([
        { id: tu12, name: "Bash", input: { command: "git commit -m 'feat: add authentication'" } },
      ]),
      makeToolResultEntry(tu12, "[main 1234567] feat: add authentication", false),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.overall).toBe("strong");
    expect(result.contextDifficulty).toBeGreaterThanOrEqual(60);
    expect(result.verifiability).toBeGreaterThanOrEqual(60);
  });

  test("detects Driver MCP tool calls and tracks count", () => {
    const tu1 = nextId();
    const tu2 = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeAssistantEntry([
        {
          id: tu1,
          name: "mcp__driver__gather_task_context",
          input: { task_description: "add login" },
        },
        { id: tu2, name: "Read", input: { file_path: "/src/auth.ts" } },
      ]),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.driverToolBreakdown.used).toBe(true);
    expect(result.driverToolBreakdown.totalCalls).toBe(1);
    expect(result.driverToolBreakdown.toolCounts).toEqual({ gather_task_context: 1 });
  });

  test("detects multiple Driver MCP tools with different names", () => {
    const tu1 = nextId();
    const tu2 = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeAssistantEntry([
        {
          id: tu1,
          name: "mcp__driver__get_architecture_overview",
          input: { codebase_name: "my-app" },
        },
        {
          id: tu2,
          name: "mcp__driver__get_code_map",
          input: { codebase_name: "my-app", path: "src/" },
        },
      ]),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.driverToolBreakdown.used).toBe(true);
    expect(result.driverToolBreakdown.totalCalls).toBe(2);
    expect(result.driverToolBreakdown.toolCounts).toEqual({
      get_architecture_overview: 1,
      get_code_map: 1,
    });
  });

  test("tracks per-tool counts for multiple calls to the same Driver MCP tool", () => {
    const tu1 = nextId();
    const tu2 = nextId();
    const tu3 = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeAssistantEntry([
        {
          id: tu1,
          name: "mcp__driver__gather_task_context",
          input: { task_description: "task 1" },
        },
        {
          id: tu2,
          name: "mcp__driver__get_code_map",
          input: { codebase_name: "my-app", path: "src/" },
        },
        {
          id: tu3,
          name: "mcp__driver__gather_task_context",
          input: { task_description: "task 2" },
        },
      ]),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.driverToolBreakdown.used).toBe(true);
    expect(result.driverToolBreakdown.totalCalls).toBe(3);
    expect(result.driverToolBreakdown.toolCounts).toEqual({
      gather_task_context: 2,
      get_code_map: 1,
    });
  });

  test("no Driver MCP tools → driverToolBreakdown.used is false with empty toolCounts", () => {
    const tu1 = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeAssistantEntry([
        { id: tu1, name: "Read", input: { file_path: "/src/foo.ts" } },
      ]),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.driverToolBreakdown.used).toBe(false);
    expect(result.driverToolBreakdown.totalCalls).toBe(0);
    expect(result.driverToolBreakdown.toolCounts).toEqual({});
  });

  test("ignores x-error entries gracefully", () => {
    const tuTest = nextId();

    const conversations: readonly ExtendedConversation[] = [
      { type: "x-error", line: "not valid json {", lineNumber: 1 },
      makeAssistantEntry([{ id: tuTest, name: "Bash", input: { command: "npm test" } }]),
      makeToolResultEntry(tuTest, "Tests passed", false),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.testRunnerInvoked).toBe(true);
    expect(result.signals.lastTestRunPassed).toBe(true);
  });

  test("failed test run is detected and not counted as passed", () => {
    const tuTest = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeAssistantEntry([{ id: tuTest, name: "Bash", input: { command: "pytest" } }]),
      makeToolResultEntry(tuTest, "FAILED test_login.py::test_auth - AssertionError", true),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.testRunnerInvoked).toBe(true);
    expect(result.signals.lastTestRunPassed).toBe(false);
  });

  test("last test run result wins when multiple runs present", () => {
    const tuTest1 = nextId();
    const tuTest2 = nextId();

    const conversations: readonly ExtendedConversation[] = [
      // First run fails
      makeAssistantEntry([{ id: tuTest1, name: "Bash", input: { command: "vitest --run" } }]),
      makeToolResultEntry(tuTest1, "1 test failed", true),

      // Second run passes after fix
      makeAssistantEntry([{ id: tuTest2, name: "Bash", input: { command: "vitest --run" } }]),
      makeToolResultEntry(tuTest2, "All tests passed", false),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.testRunnerInvoked).toBe(true);
    expect(result.signals.lastTestRunPassed).toBe(true);
  });

  test("quality gate detection: typecheck and gatecheck", () => {
    const tuCheck = nextId();
    const tuGate = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeAssistantEntry([
        { id: tuCheck, name: "Bash", input: { command: "pnpm typecheck" } },
        { id: tuGate, name: "Bash", input: { command: "pnpm gatecheck check" } },
      ]),
      makeToolResultEntry(tuCheck, "", false),
      makeToolResultEntry(tuGate, "", false),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.hasQualityGate).toBe(true);
  });

  test("git push also counts as commit-or-push", () => {
    const tuPush = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeAssistantEntry([
        { id: tuPush, name: "Bash", input: { command: "git push origin main" } },
      ]),
      makeToolResultEntry(tuPush, "Branch pushed", false),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.hasCommitOrPush).toBe(true);
  });

  test("exploration-only (no edits): turnsToFirstEdit counts all turns, editFanOutDirs is 0", () => {
    const tu1 = nextId();
    const tu2 = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeAssistantEntry([
        { id: tu1, name: "Read", input: { file_path: "/src/a.ts" } },
        { id: tu2, name: "Grep", input: { pattern: "findMe" } },
      ]),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.editFanOutDirs).toBe(0);
    expect(result.signals.turnsToFirstEdit).toBe(1);
    expect(result.signals.totalAssistantTurns).toBe(1);
  });

  test("Bash search commands (grep, find, rg) count as search tool calls", () => {
    const tu1 = nextId();
    const tu2 = nextId();
    const tu3 = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeAssistantEntry([
        { id: tu1, name: "Bash", input: { command: "grep -r 'foobar' src/" } },
        { id: tu2, name: "Bash", input: { command: "find . -name '*.ts'" } },
        { id: tu3, name: "Bash", input: { command: "rg 'pattern' --type ts" } },
      ]),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.searchToolCalls).toBeGreaterThanOrEqual(3);
  });

  test("non-crisp first message (a /command) does not set hasCrispTaskStatement", () => {
    const conversations: readonly ExtendedConversation[] = [
      {
        ...baseEntry,
        uuid: nextUuid(),
        type: "user",
        message: {
          role: "user",
          content:
            "<command-message>init is analyzing your codebase…</command-message><command-name>/init</command-name>",
        },
      },
    ];
    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.hasCrispTaskStatement).toBe(false);
  });

  test("plain text user message sets hasCrispTaskStatement", () => {
    const conversations: readonly ExtendedConversation[] = [
      makeUserTextEntry("Refactor the database connection pool to use connection timeouts"),
    ];
    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.hasCrispTaskStatement).toBe(true);
  });

  test("pr-link entry sets hasPrLink", () => {
    const conversations: readonly ExtendedConversation[] = [makePrLinkEntry()];
    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.hasPrLink).toBe(true);
  });

  test("overall is 'possible' when only one sub-score is high", () => {
    // High verifiability, low context difficulty
    const tuTest = nextId();
    const tuCommit = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeUserTextEntry("Run the tests and commit"),
      makeAssistantEntry([{ id: tuTest, name: "Bash", input: { command: "jest" } }]),
      makeToolResultEntry(tuTest, "All tests passed", false),
      makeAssistantEntry([
        { id: tuCommit, name: "Bash", input: { command: "git commit -m 'chore: run tests'" } },
      ]),
      makeToolResultEntry(tuCommit, "committed", false),
      makePrLinkEntry(),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.verifiability).toBeGreaterThanOrEqual(40);
    expect(result.overall).not.toBe("weak");
  });

  test("Edit and StrReplace tool names count as edits", () => {
    const tu1 = nextId();
    const tu2 = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeAssistantEntry([
        { id: tu1, name: "Edit", input: { file_path: "/src/foo.ts" } },
        { id: tu2, name: "StrReplace", input: { file_path: "/src/bar.ts" } },
      ]),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.editFanOutDirs).toBe(1); // same /src dir
  });

  test("multiple reads of the same file count as re-reads", () => {
    const tu1 = nextId();
    const tu2 = nextId();
    const tu3 = nextId();

    const conversations: readonly ExtendedConversation[] = [
      makeAssistantEntry([{ id: tu1, name: "Read", input: { file_path: "/src/auth.ts" } }]),
      makeAssistantEntry([{ id: tu2, name: "Read", input: { file_path: "/src/auth.ts" } }]),
      makeAssistantEntry([{ id: tu3, name: "Read", input: { file_path: "/src/auth.ts" } }]),
    ];

    const result = scoreBenchmarkCandidate(conversations);
    expect(result.signals.distinctFilesRead).toBe(1);
    expect(result.signals.reReadCount).toBe(1); // auth.ts was re-read (count > 1)
  });
});
