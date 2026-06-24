import { z } from "zod";

export const tabSchema = z.enum([
  "sessions",
  "mcp",
  "tasks",
  "scheduler",
  "settings",
  "system-info",
  "benchmark",
]);

export type Tab = z.infer<typeof tabSchema>;
