import { z } from "zod";

export const plannerDraftSchema = z.object({
  goal: z.string().min(1),
  steps: z
    .array(
      z.object({
        title: z.string().min(1),
        tool: z.enum([
          "im.read",
          "doc.create",
          "slides.create",
          "rehearsal.create",
          "summary.deliver"
        ]),
        inputSummary: z.string().min(1),
        expectedOutput: z.string().min(1)
      })
    )
    .min(1),
  requiredConfirmations: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([])
});

export type PlannerDraft = z.infer<typeof plannerDraftSchema>;

