import { z } from "zod";
import { apiContextualBanditEventValidator } from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

/**
 * Read-only OpenAPI spec for ContextualBanditEvents. Events are produced by
 * the back-end snapshot orchestrator (P4.2) and are never created or
 * mutated through the API. Permissions inherit from the parent
 * experiment's project (enforced inside the model's `canRead`).
 */
export const contextualBanditEventApiSpec = {
  modelSingular: "contextualBanditEvent",
  modelPlural: "contextualBanditEvents",
  pathBase: "/contextual-bandit-events",
  apiInterface: apiContextualBanditEventValidator,
  schemas: {
    // Required by OpenApiModelSpec but unused — read-only resource.
    createBody: z.object({}).strict(),
    updateBody: z.object({}).strict(),
  },
  includeDefaultCrud: false,
  crudActions: ["get", "list"] as const,
  navDisplayName: "Contextual Bandit Events",
  navDescription:
    "Per-tick output of the contextual bandit pipeline (per-context weights + tree summary).",
} satisfies OpenApiModelSpec;

export default contextualBanditEventApiSpec;
