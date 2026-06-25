import { Trans } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  DollarSignIcon,
  DownloadIcon,
  FlaskConical,
  Loader2,
  XCircle,
} from "lucide-react";
import { type FC, useState } from "react";
import type { BenchmarkCandidateScore } from "@/lib/benchmark-candidate/scoreBenchmarkCandidate";
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

// ── main panel ────────────────────────────────────────────────────────────────

type SessionCost = {
  totalUsd: number;
  breakdown: {
    inputTokensUsd: number;
    outputTokensUsd: number;
    cacheCreationUsd: number;
    cacheReadUsd: number;
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
  const { contextDifficulty, verifiability, overall, signals, driverToolBreakdown } = score;

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
          <span className="font-mono font-medium text-sidebar-foreground">
            {formatUsd(cost.totalUsd)}
          </span>
          <span className="text-sidebar-foreground/50">session cost</span>
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
        <NumSignal value={signals.searchToolCalls} label="Search calls" />
        <NumSignal value={signals.searchMisses} label="Search misses" />
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

      {sessionId !== "" && <ExportAtifButton projectId={projectId} sessionId={sessionId} />}
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
