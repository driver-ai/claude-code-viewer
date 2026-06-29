import { Trans } from "@lingui/react";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import {
  DollarSignIcon,
  FileTextIcon,
  FlaskConical,
  GitCommitHorizontalIcon,
  MessageSquareIcon,
  PlusIcon,
  RepeatIcon,
  WaypointsIcon,
} from "lucide-react";
import { type FC, type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import type { BenchmarkCandidateScore } from "@/lib/benchmark-candidate/scoreBenchmarkCandidate";
import { formatLocaleDate } from "@/lib/date/formatLocaleDate";
import { createVirtualSessionEntries } from "@/lib/virtual-messages/createVirtualSessionEntries";
import {
  removeVirtualMessage,
  virtualMessagesAtom,
} from "@/lib/virtual-messages/virtualMessageStore";
import { Badge } from "@/web/components/ui/badge";
import { cn } from "@/web/utils";
import { useConfig } from "../../../../../../hooks/useConfig";
import { useProject } from "../../../../hooks/useProject";
import { resolveSessionTitle } from "../../../../services/firstCommandToTitle";
import { sessionProcessesAtom } from "../../store/sessionProcessesAtom";

// ── compact benchmark display for session rows ──────────────────────────────

const ratingConfig = {
  strong: {
    label: <Trans id="benchmark.strong" />,
    className: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  },
  possible: {
    label: <Trans id="benchmark.possible" />,
    className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  },
  weak: {
    label: <Trans id="benchmark.weak" />,
    className: "bg-muted text-muted-foreground border-border",
  },
} satisfies Record<BenchmarkCandidateScore["overall"], { label: ReactNode; className: string }>;

const CompactScoreBar: FC<{ value: number }> = ({ value }) => (
  <div className="h-1 flex-1 rounded-full bg-sidebar-accent overflow-hidden">
    <div
      className={cn(
        "h-full rounded-full",
        value >= 60 ? "bg-green-500" : value >= 35 ? "bg-yellow-500" : "bg-muted-foreground/40",
      )}
      style={{ width: `${value}%` }}
    />
  </div>
);

const InlineBenchmarkScore: FC<{ score: BenchmarkCandidateScore }> = ({ score }) => {
  const { label, className } = ratingConfig[score.overall];
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded border px-1 py-0 text-[10px] font-medium leading-tight",
          className,
        )}
      >
        <FlaskConical className="h-2.5 w-2.5" />
        {label}
      </span>
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <CompactScoreBar value={score.contextDifficulty} />
        <CompactScoreBar value={score.verifiability} />
      </div>
    </div>
  );
};

// ── main component ───────────────────────────────────────────────────────────

export const SessionsTab: FC<{
  currentSessionId: string;
  projectId: string;
  onSessionSelect?: () => void;
}> = ({ currentSessionId, projectId, onSessionSelect }) => {
  const {
    data: projectData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useProject(projectId);
  const sessionProcesses = useAtomValue(sessionProcessesAtom);
  const virtualMessages = useAtomValue(virtualMessagesAtom);

  const projectSource = projectData.pages[0]?.project.meta.source ?? "claude-code";

  const sessions = useMemo(() => {
    const serverSessions = projectData.pages.flatMap((page) => page.sessions);
    const existingIds = new Set(serverSessions.map((s) => s.id));
    const virtualSessions = createVirtualSessionEntries(virtualMessages, projectId, existingIds);
    return [...serverSessions, ...virtualSessions];
  }, [projectData.pages, projectId, virtualMessages]);

  // Clean up virtual messages once the server session list includes them
  useEffect(() => {
    const serverIds = new Set(projectData.pages.flatMap((page) => page.sessions).map((s) => s.id));
    for (const vm of virtualMessages.values()) {
      if (vm.projectId === projectId && vm.isNewSession && serverIds.has(vm.sessionId)) {
        removeVirtualMessage(vm.sessionId);
      }
    }
  }, [projectData.pages, projectId, virtualMessages]);

  const { config } = useConfig();
  const activeSessionRef = useRef<HTMLAnchorElement>(null);

  // Scroll the active session into view when switching sessions.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally fires on currentSessionId change only
  useEffect(() => {
    activeSessionRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [currentSessionId]);
  const currentTab = "sessions";

  const isNewChatActive = currentSessionId === "";

  // Sort sessions: Running > Paused > Others, then by lastModifiedAt (newest first)
  const sortedSessions = useMemo(() => {
    // Define priority: running = 0, paused = 1, others = 2
    const getPriority = (status: "paused" | "running" | undefined) => {
      if (status === "running") return 0;
      if (status === "paused") return 1;
      return 2;
    };

    return [...sessions].sort((a, b) => {
      const aStatus = sessionProcesses.find((process) => process.sessionId === a.id)?.status;
      const bStatus = sessionProcesses.find((process) => process.sessionId === b.id)?.status;

      const aPriority = getPriority(aStatus);
      const bPriority = getPriority(bStatus);

      // First sort by priority
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // Then sort by lastModifiedAt (newest first)
      const aTime = a.lastModifiedAt ? new Date(a.lastModifiedAt).getTime() : 0;
      const bTime = b.lastModifiedAt ? new Date(b.lastModifiedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [sessions, sessionProcesses]);

  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting === true && hasNextPage === true && !isFetchingNextPage) {
            void fetchNextPage();
          }
        },
        { threshold: 0 },
      );
      observer.observe(node);
      return () => observer.disconnect();
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-sidebar-border p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-lg">
            <Trans id="sessions.title" />
          </h2>
        </div>
        <p className="text-xs text-sidebar-foreground/70">
          {sessions.length} <Trans id="sessions.total" />
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <Link
          to="/projects/$projectId/session"
          params={{ projectId }}
          search={{ tab: currentTab }}
          onClick={onSessionSelect}
          className={cn(
            "block rounded-lg p-2.5 transition-all duration-200 border-2 border-dashed border-sidebar-border/60 hover:border-blue-400/80 hover:bg-blue-50/50 dark:hover:bg-blue-950/40 bg-sidebar/10",
            isNewChatActive &&
              "bg-blue-100 dark:bg-blue-900/40 border-blue-400 dark:border-blue-500 shadow-sm",
          )}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <PlusIcon className="w-4 h-4" />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-sidebar-foreground">
                <Trans id="chat.modal.title" />
              </p>
            </div>
          </div>
        </Link>
        {sortedSessions.map((session) => {
          const isActive = session.id === currentSessionId;
          const title = resolveSessionTitle(
            session.meta.customTitle,
            session.meta.firstUserMessage,
            session.id,
          );

          const sessionProcess = sessionProcesses.find((task) => task.sessionId === session.id);
          const isRunning = sessionProcess?.status === "running";
          const isPaused = sessionProcess?.status === "paused";

          return (
            <Link
              key={session.id}
              ref={isActive ? activeSessionRef : undefined}
              to="/projects/$projectId/session"
              params={{ projectId }}
              search={{ tab: currentTab, sessionId: session.id }}
              onClick={onSessionSelect}
              className={cn(
                "group relative block rounded-lg p-2.5 transition-all duration-200 hover:bg-blue-50/60 dark:hover:bg-blue-950/40 hover:border-blue-300/60 dark:hover:border-blue-700/60 hover:shadow-sm border border-sidebar-border/40 bg-sidebar/30",
                isActive &&
                  "bg-blue-100 dark:bg-blue-900/50 border-blue-400 dark:border-blue-600 shadow-md ring-1 ring-blue-200/50 dark:ring-blue-700/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:border-blue-400 dark:hover:border-blue-600",
              )}
            >
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2 pr-6">
                  <h3 className="text-sm font-medium line-clamp-2 leading-tight text-sidebar-foreground flex-1">
                    {title}
                  </h3>
                  {projectSource === "cursor" && (
                    <Badge
                      variant="outline"
                      className="text-[10px] shrink-0 px-1.5 py-0 text-muted-foreground"
                    >
                      Cursor
                    </Badge>
                  )}
                  {(isRunning || isPaused) && (
                    <Badge
                      variant={isRunning ? "default" : "secondary"}
                      className={cn(
                        "text-xs shrink-0",
                        isRunning && "bg-green-500 text-white",
                        isPaused && "bg-yellow-500 text-white",
                      )}
                    >
                      {isRunning ? (
                        <Trans id="session.status.running" />
                      ) : (
                        <Trans id="session.status.paused" />
                      )}
                    </Badge>
                  )}
                </div>
                {"benchmarkScore" in session &&
                  session.benchmarkScore !== undefined &&
                  session.benchmarkScore !== null && (
                    <InlineBenchmarkScore score={session.benchmarkScore} />
                  )}
                <div className="flex items-center gap-2 text-xs text-sidebar-foreground/70 mb-0.5">
                  <div className="flex items-center gap-1" title="Messages">
                    <MessageSquareIcon className="w-3 h-3" />
                    <span>{session.meta.messageCount}</span>
                  </div>
                  {"benchmarkScore" in session &&
                    session.benchmarkScore !== undefined &&
                    session.benchmarkScore !== null && (
                      <>
                        <div className="flex items-center gap-1" title="Turns">
                          <RepeatIcon className="w-3 h-3" />
                          <span>{session.benchmarkScore.signals.totalAssistantTurns}</span>
                        </div>
                        <div className="flex items-center gap-1" title="Files read">
                          <FileTextIcon className="w-3 h-3" />
                          <span>{session.benchmarkScore.signals.distinctFilesRead}</span>
                        </div>
                        {session.benchmarkScore.signals.hasCommitOrPush && (
                          <span title="Committed / pushed">
                            <GitCommitHorizontalIcon className="w-3 h-3 text-green-600 dark:text-green-400" />
                          </span>
                        )}
                        {session.benchmarkScore.driverToolBreakdown.used && (
                          <div
                            className="flex items-center gap-1 text-blue-600 dark:text-blue-400"
                            title="Driver MCP calls"
                          >
                            <WaypointsIcon className="w-3 h-3" />
                            <span>{session.benchmarkScore.driverToolBreakdown.totalCalls}</span>
                          </div>
                        )}
                      </>
                    )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-sidebar-foreground/50">
                  {session.meta.cost.totalUsd > 0 && (
                    <span className="flex items-center gap-0.5 font-mono">
                      <DollarSignIcon className="w-2.5 h-2.5" />
                      {session.meta.cost.totalUsd.toFixed(2)}
                    </span>
                  )}
                  {session.lastModifiedAt && (
                    <span>
                      {formatLocaleDate(session.lastModifiedAt, {
                        locale: config.locale,
                        target: "time",
                      })}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}

        {hasNextPage === true && (
          <div ref={sentinelRef} className="flex items-center justify-center p-4">
            {isFetchingNextPage && (
              <span className="text-xs text-sidebar-foreground/50">
                <Trans id="common.loading" />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
