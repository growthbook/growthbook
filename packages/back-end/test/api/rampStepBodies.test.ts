import type { ZodType } from "zod";
import {
  putFeatureRevisionRuleRampScheduleValidator,
  putFeatureRevisionRuleRampScheduleV2Validator,
  postFeatureRevisionRuleAddValidator,
} from "shared/validators";
import { rampScheduleApiSpec } from "back-end/src/api/specs/ramp-schedule.spec";
import { rampScheduleTemplateApiSpec } from "back-end/src/api/specs/ramp-schedule-template.spec";
import { postBodyStep } from "back-end/src/api/ramp-schedules/postRampSchedule";
import { putStepSchema } from "back-end/src/api/ramp-schedules/rampScheduleActions";

// A rule field placed on a step (or action) instead of inside `patch` used to
// be silently dropped, leaving a step that applies nothing. Every ramp write
// body now rejects unknown keys at each level, while a step echoed from a GET
// and an approval-only step with no actions still parse.

type Step = Record<string, unknown>;
const action = {
  targetType: "feature-rule",
  targetId: "t1",
  patch: { ruleId: "fr_1", coverage: 0.5 },
};
const echoedStep: Step = {
  interval: 3600,
  actions: [action],
  approvalNotes: null,
  monitored: false,
  holdConditions: { requiresApproval: true },
};
const approvalOnlyStep: Step = {
  interval: null,
  holdConditions: { requiresApproval: true },
};

// [surface, body schema, wrap a step into a full body, issue path prefix,
// whether the surface carries step actions]
const surfaces: [string, ZodType, (step: Step) => unknown, string, boolean][] =
  [
    ["REST create", postBodyStep, (s) => s, "", true],
    [
      "REST update",
      rampScheduleApiSpec.schemas.updateBody,
      (s) => ({ steps: [s] }),
      "steps.0",
      true,
    ],
    ["REST steps endpoint", putStepSchema, (s) => s, "", false],
    [
      "revision ramp-schedule",
      putFeatureRevisionRuleRampScheduleValidator.bodySchema,
      (s) => ({ steps: [s] }),
      "steps.0",
      true,
    ],
    [
      "inline rampSchedule on rule add",
      postFeatureRevisionRuleAddValidator.bodySchema,
      (s) => ({
        environment: "production",
        rule: { type: "force", value: "true" },
        rampSchedule: { steps: [s] },
      }),
      "rampSchedule.steps.0",
      true,
    ],
    [
      "revision ramp-schedule (v2)",
      putFeatureRevisionRuleRampScheduleV2Validator.bodySchema,
      (s) => ({ steps: [s] }),
      "steps.0",
      true,
    ],
    [
      "template create",
      rampScheduleTemplateApiSpec.schemas.createBody,
      (s) => ({ name: "t", steps: [s] }),
      "steps.0",
      true,
    ],
    [
      "template update",
      rampScheduleTemplateApiSpec.schemas.updateBody,
      (s) => ({ steps: [s] }),
      "steps.0",
      true,
    ],
  ];

// "<path>:<keys>" for every unrecognized-key issue, path relative to the step.
const unrecognized = (
  schema: ZodType,
  wrap: (step: Step) => unknown,
  prefix: string,
  step: Step,
) => {
  const res = schema.safeParse(wrap(step));
  if (res.success) return [];
  return res.error.issues
    .filter((i) => i.code === "unrecognized_keys")
    .map((i) => {
      const path = i.path.join(".");
      const rel = prefix ? path.slice(prefix.length).replace(/^\./, "") : path;
      return `${rel}:${"keys" in i ? i.keys.join(",") : ""}`;
    });
};

describe.each(surfaces)(
  "%s step body",
  (_label, schema, wrap, prefix, hasActions) => {
    const bad = (step: Step) => unrecognized(schema, wrap, prefix, step);
    // Templates require an actions array on every step; others default it.
    const approvalOnly = hasActions
      ? { ...approvalOnlyStep, actions: [] }
      : approvalOnlyStep;

    it("rejects a rule field placed on the step or nested in holdConditions", () => {
      expect(bad({ ...approvalOnly, coverage: 0.5 })).toEqual([":coverage"]);
      expect(
        bad({
          ...approvalOnly,
          holdConditions: { requiresApproval: true, note: "x" },
        }),
      ).toEqual(["holdConditions:note"]);
    });

    if (hasActions) {
      it("rejects unknown keys on an action or inside its patch", () => {
        expect(
          bad({ interval: 1, actions: [{ ...action, coverage: 0.5 }] }),
        ).toEqual(["actions.0:coverage"]);
        expect(
          bad({
            interval: 1,
            actions: [{ ...action, patch: { ...action.patch, weight: 1 } }],
          }),
        ).toEqual(["actions.0.patch:weight"]);
      });
    }

    it("still accepts a step echoed from a GET and an approval-only step", () => {
      // Force-rule patches carry `force`; a template copy tolerates it.
      const withForce = {
        ...echoedStep,
        actions: [{ ...action, patch: { ...action.patch, force: "on" } }],
      };
      expect(schema.safeParse(wrap(echoedStep)).success).toBe(true);
      expect(schema.safeParse(wrap(withForce)).success).toBe(true);
      expect(schema.safeParse(wrap(approvalOnly)).success).toBe(true);
    });
  },
);
