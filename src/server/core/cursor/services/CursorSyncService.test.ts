import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect } from "vitest";
import { makeDrizzleTestServiceLayer } from "../../../../testing/layers/testDrizzleServiceLayer.ts";
import { testPlatformLayer } from "../../../../testing/layers/testPlatformLayer.ts";
import { DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { projects, sessions } from "../../../lib/db/schema.ts";
import { CursorSyncService } from "./CursorSyncService.ts";

// ---------------------------------------------------------------------------
// Fixture content — realistic Cursor agent transcript JSONL
// ---------------------------------------------------------------------------

const fixtureJsonlLines = [
  JSON.stringify({
    role: "user",
    message: { content: [{ type: "text", text: "Hello" }] },
  }),
  JSON.stringify({
    role: "assistant",
    message: {
      content: [
        { type: "text", text: "I'll help" },
        { type: "tool_use", name: "ReadFile", input: { path: "test.ts" } },
      ],
    },
  }),
  JSON.stringify({ type: "turn_ended", status: "success" }),
];

const fixtureJsonlContent = fixtureJsonlLines.join("\n") + "\n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the layer stack for CursorSyncService integration tests.
 * Uses a real Node filesystem + in-memory Drizzle + EnvService pointing HOME
 * at the provided tmpdir so CursorSyncService discovers fixture files.
 */
const makeTestLayer = (homeDir: string) => {
  const drizzleLayer = makeDrizzleTestServiceLayer();
  const platformLayer = testPlatformLayer({ env: { HOME: homeDir } });

  return CursorSyncService.Live.pipe(
    Layer.provideMerge(drizzleLayer),
    Layer.provideMerge(platformLayer),
    Layer.provideMerge(NodeContext.layer),
  );
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CursorSyncService", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* fs.makeTempDirectoryScoped();
      }).pipe(Effect.provide(NodeContext.layer), Effect.scoped),
    );
  });

  afterEach(async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.remove(tmpDir, { recursive: true });
      }).pipe(
        Effect.provide(NodeContext.layer),
        Effect.catchAll(() => Effect.void),
      ),
    );
  });

  it.live("syncs Cursor sessions from fixture JSONL files into the database", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      // Set up the directory structure mimicking ~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl
      const projectSlug = "Users-fangio-Code-myproject";
      const sessionUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const transcriptsDir = `${tmpDir}/.cursor/projects/${projectSlug}/agent-transcripts/${sessionUuid}`;

      yield* fs.makeDirectory(transcriptsDir, { recursive: true });
      yield* fs.writeFileString(`${transcriptsDir}/${sessionUuid}.jsonl`, fixtureJsonlContent);

      const testLayer = makeTestLayer(tmpDir);

      // Run the sync
      yield* Effect.gen(function* () {
        const cursorSync = yield* CursorSyncService;
        yield* cursorSync.syncCursorSessions();
      }).pipe(Effect.provide(testLayer));

      // Verify the DB state
      yield* Effect.gen(function* () {
        const drizzle = yield* DrizzleService;
        const { db } = drizzle;

        // Check project was created with source: "cursor"
        const allProjects = db.select().from(projects).all();
        expect(allProjects).toHaveLength(1);

        const project = allProjects.at(0);
        if (project === undefined) throw new Error("Expected project row");
        expect(project.source).toBe("cursor");
        expect(project.name).toBe("myproject");
        expect(project.sessionCount).toBe(1);

        // Check session was created with source: "cursor"
        const allSessions = db.select().from(sessions).all();
        expect(allSessions).toHaveLength(1);

        const session = allSessions.at(0);
        if (session === undefined) throw new Error("Expected session row");
        expect(session.id).toBe(sessionUuid);
        expect(session.source).toBe("cursor");
        // messageCount is based on non-empty lines in the raw JSONL content
        // All 3 lines (user, assistant, turn_ended) are non-empty
        expect(session.messageCount).toBe(3);
      }).pipe(Effect.provide(testLayer));
    }).pipe(Effect.provide(NodeContext.layer)),
  );

  it.live("syncs multiple sessions across multiple projects", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      // Project 1 with 1 session
      // Slug "Users-fangio-Code-alpha" decodes to /Users/fangio/Code/alpha → basename "alpha"
      const slug1 = "Users-fangio-Code-alpha";
      const session1 = "11111111-1111-1111-1111-111111111111";
      const dir1 = `${tmpDir}/.cursor/projects/${slug1}/agent-transcripts/${session1}`;
      yield* fs.makeDirectory(dir1, { recursive: true });
      yield* fs.writeFileString(`${dir1}/${session1}.jsonl`, fixtureJsonlContent);

      // Project 2 with 2 sessions
      // Slug "Users-fangio-Code-beta" decodes to /Users/fangio/Code/beta → basename "beta"
      const slug2 = "Users-fangio-Code-beta";
      const session2a = "22222222-2222-2222-2222-222222222222";
      const session2b = "33333333-3333-3333-3333-333333333333";
      const dir2a = `${tmpDir}/.cursor/projects/${slug2}/agent-transcripts/${session2a}`;
      const dir2b = `${tmpDir}/.cursor/projects/${slug2}/agent-transcripts/${session2b}`;
      yield* fs.makeDirectory(dir2a, { recursive: true });
      yield* fs.makeDirectory(dir2b, { recursive: true });
      yield* fs.writeFileString(`${dir2a}/${session2a}.jsonl`, fixtureJsonlContent);
      yield* fs.writeFileString(`${dir2b}/${session2b}.jsonl`, fixtureJsonlContent);

      const testLayer = makeTestLayer(tmpDir);

      yield* Effect.gen(function* () {
        const cursorSync = yield* CursorSyncService;
        yield* cursorSync.syncCursorSessions();
      }).pipe(Effect.provide(testLayer));

      yield* Effect.gen(function* () {
        const drizzle = yield* DrizzleService;
        const { db } = drizzle;

        const allProjects = db.select().from(projects).all();
        expect(allProjects).toHaveLength(2);

        // All projects should have source: "cursor"
        for (const project of allProjects) {
          expect(project.source).toBe("cursor");
        }

        // Find project by session count
        const projectBeta = allProjects.find((p) => p.sessionCount === 2);
        if (projectBeta === undefined) throw new Error("Expected project with 2 sessions");
        expect(projectBeta.name).toBe("beta");

        const projectAlpha = allProjects.find((p) => p.sessionCount === 1);
        if (projectAlpha === undefined) throw new Error("Expected project with 1 session");
        expect(projectAlpha.name).toBe("alpha");

        const allSessions = db.select().from(sessions).all();
        expect(allSessions).toHaveLength(3);

        for (const session of allSessions) {
          expect(session.source).toBe("cursor");
        }
      }).pipe(Effect.provide(testLayer));
    }).pipe(Effect.provide(NodeContext.layer)),
  );

  it.live("skips sync when .cursor/projects directory does not exist", () =>
    Effect.gen(function* () {
      // tmpDir exists but has no .cursor/projects — sync should be a no-op
      const testLayer = makeTestLayer(tmpDir);

      yield* Effect.gen(function* () {
        const cursorSync = yield* CursorSyncService;
        yield* cursorSync.syncCursorSessions();
      }).pipe(Effect.provide(testLayer));

      yield* Effect.gen(function* () {
        const drizzle = yield* DrizzleService;
        const { db } = drizzle;

        const allProjects = db.select().from(projects).all();
        expect(allProjects).toHaveLength(0);

        const allSessions = db.select().from(sessions).all();
        expect(allSessions).toHaveLength(0);
      }).pipe(Effect.provide(testLayer));
    }).pipe(Effect.provide(NodeContext.layer)),
  );
});
