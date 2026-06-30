import { Trans } from "@lingui/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import { type FC, useCallback, useEffect, useMemo } from "react";
import { formatLocaleDate } from "@/lib/date/formatLocaleDate";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { Route } from "@/web/routes/projects/index";
import { cn } from "@/web/utils";
import { useConfig } from "../../hooks/useConfig";
import { useProjects } from "../hooks/useProjects";

type SourceFilter = "all" | "claude-code" | "cursor";

const sourceFilterOptions: ReadonlyArray<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
];

export const ProjectList: FC = () => {
  const {
    data: { projects },
  } = useProjects();
  const { config } = useConfig();
  const { source: sourceFilter } = Route.useSearch();
  const navigate = useNavigate();

  useEffect(() => {
    if (sourceFilter !== "all") {
      localStorage.setItem("ccv:source-filter", sourceFilter);
    } else {
      localStorage.removeItem("ccv:source-filter");
    }
  }, [sourceFilter]);

  const setSourceFilter = useCallback(
    (value: SourceFilter) => {
      void navigate({
        to: "/projects",
        search: { source: value === "all" ? undefined : value },
        replace: true,
      });
    },
    [navigate],
  );

  const hasCursorProjects = projects.some((p) => p.meta.source === "cursor");

  const filteredProjects = useMemo(() => {
    if (sourceFilter === "all") return projects;
    return projects.filter((p) => p.meta.source === sourceFilter);
  }, [projects, sourceFilter]);

  if (projects.length === 0) {
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <FolderIcon className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">
          <Trans id="project_list.no_projects.title" />
        </h3>
        <p className="text-muted-foreground text-center max-w-md">
          <Trans id="project_list.no_projects.description" />
        </p>
      </CardContent>
    </Card>;
  }

  return (
    <div className="space-y-4">
      {hasCursorProjects && (
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
          {sourceFilterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSourceFilter(option.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                sourceFilter === option.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredProjects.map((project) => (
          <Card key={project.id} className="hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 justify-start items-start">
                <FolderIcon className="w-5 h-5 flex-shrink-0" />
                <span className="text-wrap flex-1">
                  {project.meta.projectName ?? project.claudeProjectPath}
                </span>
                {project.meta.source === "cursor" && (
                  <Badge variant="outline" className="text-[10px] shrink-0 px-1.5 py-0">
                    Cursor
                  </Badge>
                )}
              </CardTitle>
              {project.meta.projectPath !== undefined && project.meta.projectPath !== "" ? (
                <CardDescription>{project.meta.projectPath}</CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                <Trans id="project_list.last_modified" />{" "}
                {project.lastModifiedAt
                  ? formatLocaleDate(project.lastModifiedAt, {
                      locale: config.locale,
                      target: "time",
                    })
                  : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                <Trans id="project_list.messages" /> {project.meta.sessionCount}
              </p>
            </CardContent>
            <CardContent className="pt-0">
              <Button asChild className="w-full">
                <Link
                  to={"/projects/$projectId/session"}
                  params={{ projectId: project.id }}
                  search={{ tab: "sessions" }}
                >
                  <Trans id="project_list.view_conversations" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
