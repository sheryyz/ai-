import { SlugSchema } from './ids'
import { z } from './zod'

const Option = z.object({ label: z.string().min(1).max(80), effect: z.string().min(1).max(240) }).strict()
export const IntentBriefSchema = z
  .object({
    summary: z.string().min(1).max(300),
    questions: z
      .array(
        z
          .object({
            question: z.string().min(1).max(200),
            reason: z.string().min(1).max(240),
            options: z.array(Option).min(2).max(3),
          })
          .strict(),
      )
      .max(3),
    alternatives: z
      .array(
        z
          .object({
            title: z.string().min(1).max(60),
            approach: z.string().min(1).max(400),
            tradeoff: z.string().min(1).max(240),
          })
          .strict(),
      )
      .length(2),
  })
  .strict()
export type IntentBrief = z.infer<typeof IntentBriefSchema>
export interface PreparedIntent {
  id: string
  appId: string | null
  baseVersion: number | null
  intent: string
  brief: IntentBrief
  createdAt: string
  resolution?: { answers: number[]; choice: 0 | 1 | 'compare' }
}
export const ResolveIntentSchema = z
  .object({
    briefId: z.string(),
    answers: z.array(z.number().int().min(0).max(2)).max(3),
    choice: z.union([z.literal(0), z.literal(1), z.literal('compare')]),
  })
  .strict()
export const PhaseInputSchema = z
  .object({
    baseVersion: z.number().int().min(1),
    name: z.string().trim().min(1).max(40),
    disabledNodes: z.array(SlugSchema).max(32),
  })
  .strict()
export type PhaseInput = z.infer<typeof PhaseInputSchema>
export interface AppPhase {
  id: string
  name: string
  visibility: { nodeId: string; hidden: boolean }[]
  createdAt: string
}
