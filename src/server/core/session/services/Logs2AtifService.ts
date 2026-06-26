import { Command, FileSystem, Path } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Context, Data, Effect, Either, Layer, Stream } from "effect";
import type { InferEffect } from "../../../lib/effect/types.ts";
import { EnvService } from "../../platform/services/EnvService.ts";

/**
 * Git spec used to provision logs2atif on demand via `uv` when it is not already
 * installed on PATH. Pinned to the default branch (`develop`).
 */
const LOGS2ATIF_GIT_SPEC = "git+https://github.com/driver-ai/logs2atif@develop";

/** Raised when neither a `logs2atif` binary nor `uv`/`uvx` could be located on PATH. */
export class Logs2AtifNotAvailableError extends Data.TaggedError("Logs2AtifNotAvailableError")<{
  message: string;
}> {}

type Runner = {
  command: string;
  baseArgs: string[];
};

export type Logs2AtifConvertResult = {
  /** The exact command line that was executed (display-friendly, with quoting). */
  command: string;
  /** Combined stdout + stderr produced by logs2atif. */
  output: string;
  /** The produced ATIF v1.7 trajectory JSON, or null when conversion produced no output. */
  content: string | null;
  /** Process exit code (-1 when the process could not be started). */
  exitCode: number;
};

/** Renders a command + args into a display-friendly line, quoting parts that contain spaces. */
const formatCommandLine = (command: string, args: string[]): string =>
  [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");

const collectStream = (stream: Stream.Stream<Uint8Array, PlatformError>) =>
  stream.pipe(Stream.decodeText("utf-8"), Stream.mkString);

const LayerImpl = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const envService = yield* EnvService;

  const commandExists = (name: string, env: Record<string, string>) =>
    Effect.gen(function* () {
      const lookup =
        process.platform === "win32" ? Command.make("where", name) : Command.make("which", name);

      const result = yield* Effect.either(Command.exitCode(lookup.pipe(Command.env(env))));

      return Either.isRight(result) && result.right === 0;
    });

  /**
   * Resolves how to invoke logs2atif, preferring a pre-installed binary and falling
   * back to `uv tool run` so the only host requirement is `uv`. This is the single
   * place to extend for future distribution strategies (e.g. a bundled binary).
   */
  const resolveRunner = (env: Record<string, string>) =>
    Effect.gen(function* () {
      if (yield* commandExists("logs2atif", env)) {
        return { command: "logs2atif", baseArgs: [] } satisfies Runner;
      }

      if (yield* commandExists("uvx", env)) {
        return {
          command: "uvx",
          baseArgs: ["--from", LOGS2ATIF_GIT_SPEC, "logs2atif"],
        } satisfies Runner;
      }

      if (yield* commandExists("uv", env)) {
        return {
          command: "uv",
          baseArgs: ["tool", "run", "--from", LOGS2ATIF_GIT_SPEC, "logs2atif"],
        } satisfies Runner;
      }

      return yield* Effect.fail(
        new Logs2AtifNotAvailableError({
          message:
            "logs2atif is not available. Install it (or `uv`) so the viewer can convert sessions to ATIF: `uv tool install git+https://github.com/driver-ai/logs2atif@develop`.",
        }),
      );
    });

  /**
   * Converts a single Claude Code session JSONL file to an ATIF v1.7 trajectory by
   * shelling out to logs2atif. Returns the executed command line, its combined output,
   * and the produced `.atif.json` content (null when nothing was produced) so callers
   * can surface the full execution to the user.
   */
  const convert = (sessionFilePath: string) =>
    Effect.gen(function* () {
      const env = yield* envService.getAllEnv();
      const runner = yield* resolveRunner(env);

      const outputDir = yield* fs.makeTempDirectory({ prefix: "logs2atif-" });

      const args = [...runner.baseArgs, sessionFilePath, outputDir, "--pricing", "builtin"];
      const commandLine = formatCommandLine(runner.command, args);

      return yield* Effect.gen(function* () {
        const command = Command.make(runner.command, ...args).pipe(
          Command.env(env),
          Command.stdout("pipe"),
          Command.stderr("pipe"),
        );

        const runResult = yield* Effect.either(
          Effect.scoped(
            Effect.gen(function* () {
              const process = yield* Command.start(command);
              const [exitCode, stdout, stderr] = yield* Effect.all(
                [process.exitCode, collectStream(process.stdout), collectStream(process.stderr)],
                { concurrency: "unbounded" },
              );
              return { exitCode: Number(exitCode), stdout, stderr };
            }),
          ),
        );

        let exitCode = -1;
        let output = "";
        if (Either.isRight(runResult)) {
          exitCode = runResult.right.exitCode;
          output = [runResult.right.stdout, runResult.right.stderr]
            .map((chunk) => chunk.trimEnd())
            .filter((chunk) => chunk !== "")
            .join("\n");
        } else {
          output = `Failed to start logs2atif: ${String(runResult.left)}`;
        }

        const entries = yield* fs.readDirectory(outputDir);
        const atifFile = entries.find((entry) => entry.endsWith(".atif.json"));
        const content =
          atifFile !== undefined ? yield* fs.readFileString(path.join(outputDir, atifFile)) : null;

        return {
          command: commandLine,
          output,
          content,
          exitCode,
        } satisfies Logs2AtifConvertResult;
      }).pipe(Effect.ensuring(fs.remove(outputDir, { recursive: true }).pipe(Effect.ignore)));
    });

  return {
    convert,
  };
});

export type ILogs2AtifService = InferEffect<typeof LayerImpl>;

export class Logs2AtifService extends Context.Tag("Logs2AtifService")<
  Logs2AtifService,
  ILogs2AtifService
>() {
  static Live = Layer.effect(this, LayerImpl);
}
