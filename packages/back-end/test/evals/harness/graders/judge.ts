import { generateText, Output } from "ai";
import { z } from "zod";
import type { AIModel } from "shared/ai";
import type { ScenarioUser } from "back-end/test/evals/harness/scenario";
import { evalModel, usageOf } from "back-end/test/evals/harness/models";
import type {
  TranscriptEvent,
  Usage,
} from "back-end/test/evals/harness/record";
import { renderTranscript } from "back-end/test/evals/harness/transcript";
import { rubricFor, type JudgeCriterion } from "./criteria";
import type { GradeResult } from "./state";

export interface JudgeVerdict extends GradeResult {
  // False when the simulated user broke character or made facts up. Such a
  // trial says nothing about the agent and is re-run.
  simulatorValid: boolean;
  simulatorReason: string;
  usage: Usage;
}

const verdictSchema = z.object({
  criteria: z.array(
    z.object({ key: z.string(), pass: z.boolean(), reason: z.string() }),
  ),
  simulator: z.object({
    followedInstructions: z.boolean(),
    reason: z.string(),
  }),
});

const SYSTEM = `You grade transcripts of an AI assistant inside GrowthBook, an experimentation platform, helping a user. The user is simulated by another model that follows private instructions.

Grade each criterion strictly from the transcript. Tool calls and their results are what the assistant actually did; ASSISTANT lines and confirmation cards are what the user saw. A criterion passes only if the transcript clearly shows it. Give one short sentence of evidence per criterion.

Separately, check the simulated user: it must stay in character, follow its instructions, and not invent facts the instructions don't give it.`;

export async function judgeTrial(
  modelId: AIModel,
  user: ScenarioUser,
  transcript: TranscriptEvent[],
  criteria: JudgeCriterion[],
): Promise<JudgeVerdict> {
  const rubrics = criteria.map(rubricFor);
  const { model, providerOptions } = evalModel(modelId);
  const result = await generateText({
    model,
    providerOptions,
    system: SYSTEM,
    output: Output.object({ schema: verdictSchema }),
    prompt: `The simulated user's opening message: ${user.opening}

The simulated user's private instructions:
<instructions>
${user.instructions}
</instructions>

Criteria (use these keys):
${rubrics.map((r) => `- ${r.key}: ${r.rubric}`).join("\n") || "(none; check only the simulated user)"}

Transcript:
<transcript>
${renderTranscript(transcript)}
</transcript>`,
  });
  const verdict = result.output;
  const reasons = rubrics.flatMap(({ key }) => {
    const graded = verdict.criteria.find((c) => c.key === key);
    if (!graded) return [`${key}: the judge returned no verdict`];
    return graded.pass ? [] : [`${key}: ${graded.reason}`];
  });
  return {
    pass: reasons.length === 0,
    reasons,
    simulatorValid: verdict.simulator.followedInstructions,
    simulatorReason: verdict.simulator.reason,
    usage: usageOf(modelId, result.usage),
  };
}
