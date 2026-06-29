import { Trans } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  DollarSignIcon,
  DownloadIcon,
  FlaskConical,
  Loader2,
  XCircle,
} from "lucide-react";
import { type FC, useState } from "react";
import type {
  BenchmarkCandidateScore,
  FileReadDetail,
  SearchCallDetail,
} from "@/lib/benchmark-candidate/scoreBenchmarkCandidate";
import { Button } from "@/web/components/ui/button";
import { sessionBenchmarkScoreQuery } from "@/web/lib/api/queries";
import { cn } from "@/web/utils";
import { useExportAtif } from "../../hooks/useExportAtif";
import { ExportAtifDialog } from "../ExportAtifDialog";

// ── sub-components ────────────────────────────────────────────────────────────

const ScoreBar: FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between text-xs">
      <span className="text-sidebar-foreground/70">{label}</span>
      <span className="font-mono font-medium text-sidebar-foreground">{value}/100</span>
    </div>
    <div className="h-1.5 w-full rounded-full bg-sidebar-accent overflow-hidden">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          value >= 60 ? "bg-green-500" : value >= 35 ? "bg-yellow-500" : "bg-muted-foreground/40",
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  </div>
);

const OverallBadge: FC<{ overall: BenchmarkCandidateScore["overall"] }> = ({ overall }) => {
  const config = {
    strong: {
      label: "Strong Candidate",
      className: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
    },
    possible: {
      label: "Possible Candidate",
      className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
    },
    weak: { label: "Weak Candidate", className: "bg-muted text-muted-foreground border-border" },
  } as const;
  const { label, className } = config[overall];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <FlaskConical className="h-3 w-3" />
      {label}
    </span>
  );
};

const BoolSignal: FC<{ value: boolean; label: string }> = ({ value, label }) => (
  <div className="flex items-center gap-2 text-xs">
    {value ? (
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
    ) : (
      <XCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
    )}
    <span
      className={cn("truncate", value ? "text-sidebar-foreground" : "text-sidebar-foreground/50")}
    >
      {label}
    </span>
  </div>
);

const NumSignal: FC<{ value: number; label: string; suffix?: string }> = ({
  value,
  label,
  suffix,
}) => (
  <div className="flex items-center justify-between text-xs">
    <span className="text-sidebar-foreground/70">{label}</span>
    <span className="font-mono text-sidebar-foreground">
      {value}
      {suffix !== undefined && suffix !== "" ? ` ${suffix}` : ""}
    </span>
  </div>
);

const FileReadList: FC<{ files: readonly FileReadDetail[] }> = ({ files }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (files.length === 0) return null;

  const maxCount = files[0]?.count ?? 1;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-[10px] text-sidebar-foreground/50 hover:text-sidebar-foreground/70 transition-colors"
      >
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>{files.length} files</span>
      </button>
      {isOpen && (
        <div className="mt-1 max-h-48 overflow-y-auto space-y-0.5">
          {files.map((file) => {
            const name = file.path.split("/").pop() ?? file.path;
            const dir = file.path.slice(0, file.path.length - name.length - 1);
            const barWidth = Math.max(8, (file.count / maxCount) * 100);
            return (
              <div key={file.path} className="group relative" title={file.path}>
                <div
                  className="absolute inset-y-0 left-0 rounded-sm bg-sidebar-accent/60"
                  style={{ width: `${barWidth}%` }}
                />
                <div className="relative flex items-center justify-between gap-1 px-1.5 py-0.5">
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-sidebar-foreground truncate block">
                      {name}
                    </span>
                    {dir !== "" && (
                      <span className="text-[9px] text-sidebar-foreground/40 truncate block">
                        {dir}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-sidebar-foreground/60 shrink-0 tabular-nums">
                    {file.count}×
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const toolBadgeColor: Record<string, string> = {
  Grep: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  Glob: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  rg: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  SemanticSearch: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  Bash: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  Shell: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

const SearchCallList: FC<{ searches: readonly SearchCallDetail[] }> = ({ searches }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (searches.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-[10px] text-sidebar-foreground/50 hover:text-sidebar-foreground/70 transition-colors"
      >
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>{searches.length} searches</span>
      </button>
      {isOpen && (
        <div className="mt-1 max-h-48 overflow-y-auto space-y-0.5">
          {searches.map((search, i) => (
            <div
              key={`${search.tool}-${i}`}
              className={cn(
                "flex items-start gap-1.5 px-1.5 py-0.5 rounded-sm",
                search.missed && "bg-red-500/5",
              )}
            >
              <span
                className={cn(
                  "text-[9px] font-medium px-1 py-px rounded shrink-0 mt-px",
                  toolBadgeColor[search.tool] ?? "bg-muted text-muted-foreground",
                )}
              >
                {search.tool}
              </span>
              <span
                className={cn(
                  "text-[10px] font-mono break-all min-w-0",
                  search.missed ? "text-red-500/70 line-through" : "text-sidebar-foreground/60",
                )}
              >
                {search.query || "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── main panel ────────────────────────────────────────────────────────────────

type SessionCost = {
  totalUsd: number;
  breakdown: {
    inputTokensUsd: number;
    outputTokensUsd: number;
    cacheCreationUsd: number;
    cacheReadUsd: number;
  };
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
};

const formatUsd = (value: number): string =>
  value < 0.01 && value > 0 ? "<$0.01" : `$${value.toFixed(2)}`;

const ExportAtifButton: FC<{ projectId: string; sessionId: string }> = ({
  projectId,
  sessionId,
}) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const exportAtif = useExportAtif();

  return (
    <>
      <hr className="border-border" />
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          setIsDialogOpen(true);
          exportAtif.reset();
          exportAtif.mutate({ projectId, sessionId });
        }}
        disabled={exportAtif.isPending}
      >
        <DownloadIcon className={cn("w-4 h-4 mr-2", exportAtif.isPending && "animate-pulse")} />
        Export to ATIF
      </Button>
      <ExportAtifDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        isPending={exportAtif.isPending}
        error={exportAtif.error}
        result={exportAtif.data}
      />
    </>
  );
};

const ScoreDisplay: FC<{
  score: BenchmarkCandidateScore;
  cost?: SessionCost;
  projectId: string;
  sessionId: string;
}> = ({ score, cost, projectId, sessionId }) => {
  const {
    contextDifficulty,
    verifiability,
    overall,
    signals,
    driverToolBreakdown,
    fileReadDetails,
    searchCallDetails,
  } = score;

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-sidebar-foreground/70 uppercase tracking-wide">
          <Trans id="benchmark.tab.title" />
        </span>
        <OverallBadge overall={overall} />
      </div>

      {cost !== undefined && (
        <div className="flex items-center gap-1.5 text-xs">
          <DollarSignIcon className="h-3.5 w-3.5 text-sidebar-foreground/50" />
          {cost.tokenUsage.inputTokens === 0 && cost.tokenUsage.outputTokens === 0 ? (
            <>
              <span className="font-mono text-sidebar-foreground/40">N/A</span>
              <span className="text-sidebar-foreground/40">session cost</span>
            </>
          ) : (
            <>
              <span className="font-mono font-medium text-sidebar-foreground">
                {formatUsd(cost.totalUsd)}
              </span>
              <span className="text-sidebar-foreground/50">session cost</span>
            </>
          )}
        </div>
      )}

      {/* Sub-scores */}
      <div className="space-y-2">
        <ScoreBar label="Context Difficulty" value={contextDifficulty} />
        <ScoreBar label="Verifiability" value={verifiability} />
      </div>

      <hr className="border-border" />

      {/* Context signals */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wide">
          <Trans id="benchmark.signals.context" />
        </p>
        <NumSignal value={signals.distinctFilesRead} label="Files read" />
        <NumSignal value={signals.reReadCount} label="Re-reads" />
        <FileReadList files={fileReadDetails} />
        <NumSignal value={signals.searchToolCalls} label="Search calls" />
        <NumSignal value={signals.searchMisses} label="Search misses" />
        <SearchCallList searches={searchCallDetails} />
        <NumSignal value={signals.turnsToFirstEdit} label="Exploration turns" />
        <NumSignal value={signals.editFanOutDirs} label="Dirs edited" />
        <NumSignal value={signals.totalAssistantTurns} label="Total turns" />
      </div>

      <hr className="border-border" />

      {/* Verifiability signals */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wide">
          <Trans id="benchmark.signals.verifiability" />
        </p>
        <BoolSignal value={signals.hasCrispTaskStatement} label="Crisp task statement" />
        <BoolSignal value={signals.testRunnerInvoked} label="Test runner invoked" />
        <BoolSignal value={signals.lastTestRunPassed} label="Tests passed (last run)" />
        <BoolSignal value={signals.hasQualityGate} label="Quality gate ran" />
        <BoolSignal value={signals.hasCommitOrPush} label="Committed / pushed" />
        <BoolSignal value={signals.hasPrLink} label="PR created" />
      </div>

      {/* Driver MCP usage */}
      <hr className="border-border" />
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wide">
          <Trans id="benchmark.signals.driver" />
        </p>
        <BoolSignal value={driverToolBreakdown.used} label="Driver MCP used in session" />
        {driverToolBreakdown.used && (
          <>
            <NumSignal value={driverToolBreakdown.totalCalls} label="Total Driver calls" />
            {Object.entries(driverToolBreakdown.toolCounts).map(([tool, count]) => (
              <NumSignal key={tool} value={count} label={tool} />
            ))}
          </>
        )}
        <p className="text-[10px] leading-snug text-sidebar-foreground/40 pt-1">
          <Trans id="benchmark.signals.driver.note" />
        </p>
      </div>

      {sessionId !== "" &&
        cost !== undefined &&
        (cost.tokenUsage.inputTokens > 0 || cost.tokenUsage.outputTokens > 0) && (
          <ExportAtifButton projectId={projectId} sessionId={sessionId} />
        )}
    </div>
  );
};

// ── exported component ────────────────────────────────────────────────────────

export const BenchmarkTab: FC<{ projectId: string; sessionId: string }> = ({
  projectId,
  sessionId,
}) => {
  const hasSession = sessionId !== "";
  const { data, isLoading, isError } = useQuery({
    ...sessionBenchmarkScoreQuery(projectId, sessionId),
    enabled: hasSession,
  });

  if (!hasSession) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        <Trans id="benchmark.no_session" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-xs">
          <Trans id="benchmark.loading" />
        </span>
      </div>
    );
  }

  if (isError || data === undefined || data.score === undefined) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        <Trans id="benchmark.error" />
      </div>
    );
  }

  return (
    <ScoreDisplay score={data.score} cost={data.cost} projectId={projectId} sessionId={sessionId} />
  );
};
