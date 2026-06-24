import { z } from "zod";

export const LastPromptEntrySchema = z
  .object({
    type: z.literal("last-prompt"),
    lastPrompt: z.string().optional(),
    leafUuid: z.uuid().optional(),
    sessionId: z.string(),
  })
  .refine((entry) => entry.lastPrompt !== undefined || entry.leafUuid !== undefined, {
    message: "last-prompt entry requires lastPrompt or leafUuid",
  });

export type LastPromptEntry = z.infer<typeof LastPromptEntrySchema>;
