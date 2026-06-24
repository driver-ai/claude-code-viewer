import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import { scoreBenchmarkCandidate } from "../../../../lib/benchmark-candidate/scoreBenchmarkCandidate.ts";
import type { ControllerResponse } from "../../../lib/effect/toEffectResponse.ts";
import type { InferEffect } from "../../../lib/effect/types.ts";
import { AgentSessionRepository } from "../../agent-session/infrastructure/AgentSessionRepository.ts";
import { EventBus } from "../../events/services/EventBus.ts";
import { SessionRepository } from "../../session/infrastructure/SessionRepository.ts";
import { decodeSessionId } from "../functions/id.ts";
import { generateSessionHtml } from "../services/ExportService.ts";

const LayerImpl = Effect.gen(function* () {
  const sessionRepository = yield* SessionRepository;
  const agentSessionRepository = yield* AgentSessionRepository;
  const fs = yield* FileSystem.FileSystem;
  const eventBus = yield* EventBus;

  const getSession = (options: { projectId: string; sessionId: string }) =>
    Effect.gen(function* () {
      const { projectId, sessionId } = options;

      const { session } = yield* sessionRepository.getSession(projectId, sessionId);

      return {
        status: 200,
        response: { session },
      } as const satisfies ControllerResponse;
    });

  const exportSessionHtml = (options: { projectId: string; sessionId: string }) =>
    Effect.gen(function* () {
      const { projectId, sessionId } = options;

      const { session } = yield* sessionRepository.getSession(projectId, sessionId);

      if (session === null) {
        return {
          status: 404,
          response: { error: "Session not found" },
        } as const satisfies ControllerResponse;
      }

      const html = yield* generateSessionHtml(session, projectId, agentSessionRepository);

      return {
        status: 200,
        response: { html },
      } as const satisfies ControllerResponse;
    });

  const deleteSession = (options: { projectId: string; sessionId: string }) =>
    Effect.gen(function* () {
      const { projectId, sessionId } = options;
      const sessionPath = decodeSessionId(projectId, sessionId);

      // Check if session file exists
      const exists = yield* fs.exists(sessionPath);
      if (!exists) {
        return {
          status: 404,
          response: { error: "Session not found" },
        } as const satisfies ControllerResponse;
      }

      // Delete the session file
      const deleteResult = yield* fs.remove(sessionPath).pipe(
        Effect.map(() => ({ success: true, error: null }) as const),
        Effect.catchAll((error) =>
          Effect.succeed({
            success: false,
            error: `Failed to delete session: ${error.message}`,
          } as const),
        ),
      );

      if (!deleteResult.success) {
        return {
          status: 500,
          response: { error: deleteResult.error },
        } as const satisfies ControllerResponse;
      }

      // Emit sessionListChanged event to notify clients
      yield* eventBus.emit("sessionListChanged", { projectId });

      return {
        status: 200,
        response: { success: true },
      } as const satisfies ControllerResponse;
    });

  const exportSessionJsonl = (options: { projectId: string; sessionId: string }) =>
    Effect.gen(function* () {
      const { projectId, sessionId } = options;
      const sessionPath = decodeSessionId(projectId, sessionId);

      const exists = yield* fs.exists(sessionPath);
      if (!exists) {
        return {
          status: 404,
          response: { error: "Session not found" },
        } as const satisfies ControllerResponse;
      }

      const content = yield* fs.readFileString(sessionPath);
      return {
        status: 200,
        response: { content, filename: `${sessionId}.jsonl` },
      } as const satisfies ControllerResponse;
    });

  const getBenchmarkScore = (options: { projectId: string; sessionId: string }) =>
    Effect.gen(function* () {
      const { projectId, sessionId } = options;

      const { session } = yield* sessionRepository.getSession(projectId, sessionId);

      if (session === null) {
        return {
          status: 404,
          response: { error: "Session not found" },
        } as const satisfies ControllerResponse;
      }

      const score = scoreBenchmarkCandidate(session.conversations);

      return {
        status: 200,
        response: { score },
      } as const satisfies ControllerResponse;
    });

  return {
    getSession,
    exportSessionHtml,
    exportSessionJsonl,
    deleteSession,
    getBenchmarkScore,
  };
});

export type ISessionController = InferEffect<typeof LayerImpl>;
export class SessionController extends Context.Tag("SessionController")<
  SessionController,
  ISessionController
>() {
  static Live = Layer.effect(this, LayerImpl);
}
