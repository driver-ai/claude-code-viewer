import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectsPage } from "@/web/app/projects/page";
import { ProtectedRoute } from "../../components/ProtectedRoute";

const sourceEnum = z.enum(["all", "claude-code", "cursor"]);

const getStoredSourceFilter = (): z.infer<typeof sourceEnum> => {
  try {
    const stored = localStorage.getItem("ccv:source-filter");
    const parsed = sourceEnum.safeParse(stored);
    return parsed.success ? parsed.data : "all";
  } catch {
    return "all";
  }
};

const projectsSearchSchema = z.object({
  source: sourceEnum.optional().default(getStoredSourceFilter),
});

export type ProjectsSearch = z.infer<typeof projectsSearchSchema>;

const RouteComponent = () => {
  return (
    <ProtectedRoute>
      <ProjectsPage />
    </ProtectedRoute>
  );
};

export const Route = createFileRoute("/projects/")({
  validateSearch: projectsSearchSchema,
  component: RouteComponent,
});
