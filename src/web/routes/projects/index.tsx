import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectsPage } from "@/web/app/projects/page";
import { ProtectedRoute } from "../../components/ProtectedRoute";

const projectsSearchSchema = z.object({
  source: z.enum(["all", "claude-code", "cursor"]).optional().default("all"),
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
