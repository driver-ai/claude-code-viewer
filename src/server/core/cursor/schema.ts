import { z } from "zod";

const CursorContentBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  name: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  id: z.string().optional(),
});

const CursorMessageLineSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  message: z.object({
    content: z.array(CursorContentBlockSchema),
  }),
});

const CursorTurnEndedLineSchema = z.object({
  type: z.literal("turn_ended"),
});

export const CursorAgentLineSchema = z.union([CursorMessageLineSchema, CursorTurnEndedLineSchema]);

export type CursorAgentLine = z.infer<typeof CursorAgentLineSchema>;
export type CursorMessageLine = z.infer<typeof CursorMessageLineSchema>;
export type CursorContentBlock = z.infer<typeof CursorContentBlockSchema>;
