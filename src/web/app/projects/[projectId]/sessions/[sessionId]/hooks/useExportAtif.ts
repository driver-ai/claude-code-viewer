import { useMutation } from "@tanstack/react-query";
import { honoClient } from "@/web/lib/api/client";

export type AtifExportResult = {
  command: string;
  output: string;
  content: string | null;
  exitCode: number;
  filename: string;
};

export const downloadAtif = (content: string, filename: string) => {
  const file = new File([content], filename, { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  link.target = "_self";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1000);
};

export const useExportAtif = () => {
  return useMutation<AtifExportResult, Error, { projectId: string; sessionId: string }>({
    mutationFn: async (params) => {
      const response = await honoClient.api.projects[":projectId"].sessions[":sessionId"][
        "export-atif"
      ].$get({
        param: {
          projectId: params.projectId,
          sessionId: params.sessionId,
        },
      });

      const data = await response.json();

      if (!response.ok || !("content" in data)) {
        const message =
          "error" in data && typeof data.error === "string" ? data.error : response.statusText;
        throw new Error(message);
      }

      return data;
    },
  });
};
