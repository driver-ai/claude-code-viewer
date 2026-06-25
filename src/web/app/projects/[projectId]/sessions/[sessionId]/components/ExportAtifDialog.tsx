import { CheckCircle2Icon, DownloadIcon, LoaderIcon, XCircleIcon } from "lucide-react";
import type { FC } from "react";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { type AtifExportResult, downloadAtif } from "../hooks/useExportAtif";

type ExportAtifDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  error: Error | null;
  result: AtifExportResult | undefined;
};

const CodeBlock: FC<{ label: string; content: string }> = ({ label, content }) => (
  <div className="space-y-1.5">
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
    <pre className="max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap break-words">
      {content}
    </pre>
  </div>
);

export const ExportAtifDialog: FC<ExportAtifDialogProps> = ({
  open,
  onOpenChange,
  isPending,
  error,
  result,
}) => {
  const hasContent =
    result?.content !== undefined && result.content !== null && result.content !== "";
  const succeeded = result !== undefined && result.exitCode === 0 && hasContent;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Export to ATIF
            {result !== undefined &&
              (succeeded ? (
                <Badge
                  variant="secondary"
                  className="bg-green-500/10 text-green-600 dark:text-green-400"
                >
                  <CheckCircle2Icon className="w-3 h-3 mr-1" />
                  Success
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-red-500/10 text-red-600 dark:text-red-400">
                  <XCircleIcon className="w-3 h-3 mr-1" />
                  Exit {result.exitCode}
                </Badge>
              ))}
          </DialogTitle>
          <DialogDescription>
            Runs the logs2atif converter on this session and shows the command and its output.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderIcon className="w-4 h-4 animate-spin" />
              Running logs2atif… (the first run may take a moment while the tool is provisioned)
            </div>
          )}

          {error !== null && <CodeBlock label="Error" content={error.message} />}

          {result !== undefined && (
            <>
              <CodeBlock label="Command" content={result.command} />
              <CodeBlock
                label="Output"
                content={result.output !== "" ? result.output : "(no output)"}
              />
            </>
          )}
        </div>

        <DialogFooter showCloseButton>
          {result !== undefined && hasContent && (
            <Button
              onClick={() => {
                if (result.content !== null) {
                  downloadAtif(result.content, result.filename);
                }
              }}
            >
              <DownloadIcon className="w-4 h-4 mr-2" />
              Download {result.filename}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
