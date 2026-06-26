import { FileSystem, Path } from "@effect/platform";
import { count, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { projects, sessions } from "../../../lib/db/schema.ts";
import { EnvService } from "../../platform/services/EnvService.ts";
import { encodeProjectId } from "../../project/functions/id.ts";
import { extractSearchableText } from "../../search/functions/extractSearchableText.ts";
import { extractSessionTitle } from "../../session/functions/extractSessionTitle.ts";
import { extractFirstUserMessage } from "../../session/functions/isValidFirstMessage.ts";
import { extractCursorProjectSlug } from "../functions/extractCursorProjectSlug.ts";
import {
  parseCursorAgentJsonl,
  type CursorParseContext,
} from "../functions/parseCursorAgentJsonl.ts";

// ---------------------------------------------------------------------------
// CursorSyncService interface
// ---------------------------------------------------------------------------

export type ICursorSyncService = {
  readonly syncCursorSessions: () => Effect.Effect<void, Error>;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Decode a Cursor project slug back to a best-effort filesystem path.
 * Hyphens are replaced with `/` and a leading `/` is prepended.
 * Numeric-only slugs (which are meaningless) fall back to `/`.
 */
const decodeCursorSlugToPath = (slug: string): string => {
  if (/^\d+$/.test(slug)) return "/";
  return `/${slug.replaceAll("-", "/")}`;
};

/**
 * Extract basename from a posix path (no node:path dependency).
 */
const posixBasename = (p: string): string => {
  const lastSlash = p.lastIndexOf("/");
  return lastSlash === -1 ? p : p.slice(lastSlash + 1);
};

/**
 * Strip the file extension from a filename.
 */
const stripExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) return fileName;
  return fileName.slice(0, lastDot);
};

// ---------------------------------------------------------------------------
// LayerImpl
// ---------------------------------------------------------------------------

const LayerImpl = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const drizzleService = yield* DrizzleService;
  const envService = yield* EnvService;

  const { db, rawDb } = drizzleService;

  // -------------------------------------------------------------------------
  // Internal: recursively discover *.jsonl under agent-transcripts dirs
  // -------------------------------------------------------------------------

  const discoverJsonlFiles = (cursorProjectsRoot: string): Effect.Effect<string[], Error> =>
    Effect.gen(function* () {
      const projectDirs = yield* fs
        .readDirectory(cursorProjectsRoot)
        .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));

      const allFiles: string[] = [];

      for (const dirName of projectDirs) {
        const projectDir = pathService.join(cursorProjectsRoot, dirName);

        // Check if it's a directory
        const dirStat = yield* fs
          .stat(projectDir)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (!dirStat || dirStat.type !== "Directory") continue;

        const transcriptsDir = pathService.join(projectDir, "agent-transcripts");
        const transcriptsDirExists = yield* fs
          .exists(transcriptsDir)
          .pipe(Effect.catchAll(() => Effect.succeed(false)));
        if (!transcriptsDirExists) continue;

        // Read all entries under agent-transcripts (may be nested)
        const jsonlFiles = yield* collectJsonlRecursive(transcriptsDir);
        for (const f of jsonlFiles) {
          allFiles.push(f);
        }
      }

      return allFiles;
    });

  const collectJsonlRecursive = (dir: string): Effect.Effect<string[], Error> =>
    Effect.gen(function* () {
      const entries = yield* fs
        .readDirectory(dir)
        .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));

      const result: string[] = [];

      for (const entry of entries) {
        const fullPath = pathService.join(dir, entry);
        const entryStat = yield* fs
          .stat(fullPath)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (!entryStat) continue;

        if (entryStat.type === "Directory") {
          const nested = yield* collectJsonlRecursive(fullPath);
          for (const f of nested) {
            result.push(f);
          }
        } else if (entry.endsWith(".jsonl")) {
          result.push(fullPath);
        }
      }

      return result;
    });

  // -------------------------------------------------------------------------
  // Internal: parse and upsert a single Cursor session
  // -------------------------------------------------------------------------

  const parseAndUpsertCursorSession = (
    projectId: string,
    sessionId: string,
    filePath: string,
    fileMtimeMs: number,
    projectSlug: string,
  ): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const content = yield* fs
        .readFileString(filePath)
        .pipe(
          Effect.mapError(
            (e) => new Error(`Failed to read Cursor session file ${filePath}: ${e.message}`),
          ),
        );

      const cwd = decodeCursorSlugToPath(projectSlug);
      const context: CursorParseContext = {
        sessionId,
        cwd,
        timestamp: new Date(fileMtimeMs).toISOString(),
      };

      const conversations = parseCursorAgentJsonl(content, context);

      // Extract first user message
      let firstUserMessage = null;
      for (const conversation of conversations) {
        const msg = extractFirstUserMessage(conversation);
        if (msg !== undefined) {
          firstUserMessage = msg;
          break;
        }
      }

      // Extract session title
      const customTitle = extractSessionTitle(conversations);

      const messageCount = content.split("\n").filter((line) => line.trim() !== "").length;
      const now = Date.now();

      // Build searchable texts for FTS
      const ftsEntries: Array<{
        role: string;
        content: string;
        index: number;
      }> = [];
      for (let i = 0; i < conversations.length; i++) {
        const conversation = conversations[i];
        if (conversation === undefined) continue;
        const text = extractSearchableText(conversation);
        if (text !== null && text.trim() !== "") {
          ftsEntries.push({
            role: conversation.type,
            content: text,
            index: i,
          });
        }
      }

      // Upsert within a transaction
      db.transaction((tx) => {
        tx.insert(sessions)
          .values({
            id: sessionId,
            projectId,
            filePath,
            messageCount,
            firstUserMessageJson:
              firstUserMessage !== null ? JSON.stringify(firstUserMessage) : null,
            customTitle,
            totalCostUsd: 0,
            costBreakdownJson: null,
            tokenUsageJson: null,
            modelName: null,
            prLinksJson: null,
            source: "cursor",
            fileMtimeMs,
            lastModifiedAt: new Date(fileMtimeMs).toISOString(),
            syncedAt: now,
          })
          .onConflictDoUpdate({
            target: sessions.id,
            set: {
              projectId,
              filePath,
              messageCount,
              firstUserMessageJson:
                firstUserMessage !== null ? JSON.stringify(firstUserMessage) : null,
              customTitle,
              totalCostUsd: 0,
              costBreakdownJson: null,
              tokenUsageJson: null,
              modelName: null,
              prLinksJson: null,
              source: "cursor",
              fileMtimeMs,
              lastModifiedAt: new Date(fileMtimeMs).toISOString(),
              syncedAt: now,
            },
          })
          .run();

        // Delete old FTS entries for this session
        rawDb.prepare("DELETE FROM session_messages_fts WHERE session_id = ?").run(sessionId);

        // Insert new FTS entries
        for (const entry of ftsEntries) {
          rawDb
            .prepare(
              `INSERT INTO session_messages_fts (session_id, project_id, role, content, conversation_index)
             VALUES (?, ?, ?, ?, ?)`,
            )
            .run(sessionId, projectId, entry.role, entry.content, entry.index);
        }
      });
    });

  // -------------------------------------------------------------------------
  // Internal: update project session_count
  // -------------------------------------------------------------------------

  const updateProjectSessionCount = (projectId: string): void => {
    const result = db
      .select({ cnt: count() })
      .from(sessions)
      .where(eq(sessions.projectId, projectId))
      .get();
    const cnt = result?.cnt ?? 0;
    db.update(projects).set({ sessionCount: cnt }).where(eq(projects.id, projectId)).run();
  };

  // -------------------------------------------------------------------------
  // syncCursorSessions
  // -------------------------------------------------------------------------

  const syncCursorSessions = (): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const homeDirectory = yield* envService.getEnv("HOME");
      const cursorProjectsRoot = pathService.join(homeDirectory ?? "/", ".cursor", "projects");

      // Skip if Cursor projects directory doesn't exist
      const dirExists = yield* fs
        .exists(cursorProjectsRoot)
        .pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (!dirExists) return;

      // Discover all JSONL files
      const jsonlFiles = yield* discoverJsonlFiles(cursorProjectsRoot);

      // Track projects we've seen for session count updates
      const seenProjectIds = new Set<string>();

      for (const filePath of jsonlFiles) {
        yield* Effect.gen(function* () {
          const projectSlug = extractCursorProjectSlug(filePath);

          // Build a stable project ID based on "cursor:<slug>"
          const cursorProjectKey = `cursor:${projectSlug}`;
          const projectId = encodeProjectId(cursorProjectKey);
          seenProjectIds.add(projectId);

          const fileStat = yield* fs
            .stat(filePath)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));
          if (!fileStat) return;

          const fileMtimeMs = Option.getOrElse(fileStat.mtime, () => new Date(0)).getTime();

          // Derive sessionId from filename stem
          const fileName = posixBasename(filePath);
          const sessionId = stripExtension(fileName);

          // Check if session already exists and is up-to-date
          const knownSession = db
            .select({ fileMtimeMs: sessions.fileMtimeMs })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .get();

          if (knownSession !== undefined && fileMtimeMs <= knownSession.fileMtimeMs) {
            return;
          }

          // Ensure project row exists
          const existingProject = db
            .select()
            .from(projects)
            .where(eq(projects.id, projectId))
            .get();

          if (existingProject === undefined) {
            const decodedPath = decodeCursorSlugToPath(projectSlug);
            const projectName = decodedPath === "/" ? projectSlug : posixBasename(decodedPath);

            db.insert(projects)
              .values({
                id: projectId,
                name: projectName,
                path: decodedPath,
                sessionCount: 0,
                source: "cursor",
                dirMtimeMs: fileMtimeMs,
                syncedAt: Date.now(),
              })
              .onConflictDoNothing()
              .run();
          }

          yield* parseAndUpsertCursorSession(
            projectId,
            sessionId,
            filePath,
            fileMtimeMs,
            projectSlug,
          );
        }).pipe(
          Effect.catchAll((e) => {
            Effect.runFork(
              Effect.logError(
                `[CursorSyncService] Failed to sync Cursor session ${filePath}: ${String(e)}`,
              ),
            );
            return Effect.void;
          }),
        );
      }

      // Update session counts for all seen projects
      for (const projectId of seenProjectIds) {
        updateProjectSessionCount(projectId);

        // Update project syncedAt
        db.update(projects).set({ syncedAt: Date.now() }).where(eq(projects.id, projectId)).run();
      }
    });

  return {
    syncCursorSessions,
  } satisfies ICursorSyncService;
});

// ---------------------------------------------------------------------------
// CursorSyncService Tag
// ---------------------------------------------------------------------------

export class CursorSyncService extends Context.Tag("CursorSyncService")<
  CursorSyncService,
  ICursorSyncService
>() {
  static readonly Live = Layer.effect(this, LayerImpl);
}
