import { z } from "zod";

const managedByVercelValidator = z
  .object({
    type: z.literal("vercel"),
    resourceId: z.string(),
  })
  .strict();

export const managedByValidator = z.discriminatedUnion("type", [
  managedByVercelValidator,
]);

export type ManagedBy = z.infer<typeof managedByValidator>;

// A Feature Flag wholly owned by an experiment ("managed mode"): the flag is
// created with a single experiment-ref rule and every subsequent change to it
// is made from the experiment page. Direct feature writes — internal or REST —
// are refused while this marker is set. Clearing it ("ejecting") returns the
// flag to ordinary standalone editing.
const managedByExperimentValidator = z
  .object({
    type: z.literal("experiment"),
    experimentId: z.string(),
  })
  .strict();

// Deliberately NOT folded into `managedByValidator`: that union is the
// Vercel-integration ownership marker shared by projects, teams, webhooks and
// SDK connections, none of which an experiment can own.
export const featureManagedByValidator = z.discriminatedUnion("type", [
  managedByExperimentValidator,
]);
