import { z } from "zod";

export const ModeEntrySchema = z.object({
  type: z.literal("mode"),
  mode: z.string(),
  sessionId: z.string(),
});

export type ModeEntry = z.infer<typeof ModeEntrySchema>;
