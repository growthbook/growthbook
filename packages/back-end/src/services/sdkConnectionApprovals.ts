import { isEqual } from "lodash";
import { z } from "zod";
import {
  getSdkConnectionGoverningRules,
  getSdkConnectionReviewRules,
} from "shared/enterprise";
import type { ApprovalFlowConfiguration } from "shared/types/organization";
import type { SDKConnectionRevisionSnapshot } from "shared/validators";
import type { SDKConnectionInterface } from "shared/types/sdk-connection";
import type { WebhookInterface } from "shared/types/webhook";
import type { Context } from "back-end/src/models/BaseModel";
import {
  BadRequestError,
  PlanDoesNotAllowError,
} from "back-end/src/util/errors";
import type { BypassedGate } from "back-end/src/revisions/publishGates";

export function isSdkConnectionGated(
  context: Context,
  connection: SDKConnectionInterface,
): boolean {
  if (!context.hasPremiumFeature("require-approvals")) return false;
  return (
    getSdkConnectionGoverningRules(context.org.settings?.approvalFlows, {
      projects: connection.projects,
      environment: connection.environment,
    }).length > 0
  );
}

// The rules a change to a connection must clear, judged on its baseline and
// proposed scopes.
export function sdkConnectionReviewRules(
  context: Context,
  snapshot: SDKConnectionRevisionSnapshot,
  proposedChanges: unknown,
): ApprovalFlowConfiguration[] {
  if (!context.hasPremiumFeature("require-approvals")) return [];
  return getSdkConnectionReviewRules(
    context.org.settings?.approvalFlows,
    snapshot,
    proposedChanges,
  );
}

// The Vercel integration owns its webhooks and their payload format.
export function assertSdkWebhookNotManaged(
  webhook: Pick<WebhookInterface, "managedBy" | "payloadFormat"> | null,
  payloadFormat?: string,
): void {
  if (webhook?.managedBy?.type === "vercel") {
    throw new BadRequestError(
      "This SDK webhook is managed by the Vercel integration",
    );
  }
  if (
    payloadFormat === "vercelNativeIntegration" &&
    webhook?.payloadFormat !== "vercelNativeIntegration"
  ) {
    throw new BadRequestError(
      "payloadFormat vercelNativeIntegration is managed by the Vercel integration",
    );
  }
}

// Another draft's "lock other drafts" schedule holds back direct landings from
// anyone who can't bypass approval.
export async function assertNoLockingScheduledDraft(
  context: Context,
  connectionId: string,
): Promise<void> {
  if (
    await context.models.revisions.hasPublishLockingScheduledSibling(
      { type: "sdk-connection", id: connectionId },
      "",
    )
  ) {
    throw new BadRequestError(
      "Another draft of this SDK connection has a scheduled publish that locks other drafts. Cancel that schedule to publish this change.",
    );
  }
}

// How a REST caller lands a direct write on a connection under approval: it
// asks, and holds the bypass permission or the org's REST setting. The app has
// no such path and makes the change in a draft.
export type DirectWriteBypass = {
  bypassApproval?: boolean;
  restBypass: boolean;
};

export const ARCHIVE_BEFORE_DELETE =
  "This SDK connection requires approval, so it must be archived before it can be deleted.";

export function assertDirectWriteAllowed(
  context: Context,
  connections: SDKConnectionInterface[],
  bypass?: DirectWriteBypass,
  refusal = "This SDK connection requires approval. Change its webhooks in a draft revision.",
): BypassedGate[] {
  const gated = connections.filter((c) => isSdkConnectionGated(context, c));
  if (!gated.length) return [];
  if (!bypass) throw new BadRequestError(refusal);
  if (!bypass.bypassApproval) {
    throw new BadRequestError(
      `${refusal} Or pass \`{ "bypassApproval": true }\` if you have Bypass draft approvals access.`,
    );
  }
  if (
    !bypass.restBypass &&
    !gated.every((c) =>
      context.permissions.canBypassSDKConnectionApprovalChecks({
        projects: c.projects,
      }),
    )
  ) {
    context.permissions.throwPermissionError();
  }
  return [
    {
      type: "approval-required",
      outcome: "bypassed",
      via: bypass.restBypass
        ? "restApiBypassesReviews"
        : "bypassApprovalPermission",
    },
  ];
}

// Free plans get one SDK webhook. A draft that swaps it for another still fits.
export async function assertSdkWebhookPlanLimit(
  context: Context,
  added: number,
  removed = 0,
): Promise<void> {
  if (added <= 0 || context.hasPremiumFeature("multiple-sdk-webhooks")) return;
  const existing = await context.models.sdkWebhooks.countSdkWebhooksByOrg();
  if (existing - removed + added > 1) {
    throw new PlanDoesNotAllowError("Your plan only supports one SDK webhook.");
  }
}

// Checked wherever a webhook's endpoint or headers change.
export function assertSdkWebhookFields({
  endpoint,
  headers,
}: {
  endpoint?: string;
  headers?: string;
}): void {
  if (endpoint !== undefined && !z.string().url().safeParse(endpoint).success) {
    throw new BadRequestError("endpoint must be a URL");
  }
  if (!headers) return;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(headers);
  } catch {
    // Refused below.
  }
  if (!z.record(z.string(), z.string()).safeParse(parsed).success) {
    throw new BadRequestError(
      "headers must be a JSON-encoded object of strings",
    );
  }
}

// What an edit writes: a new endpoint starts with a clean failure record.
export function sdkWebhookEditUpdates<T extends { endpoint?: string }>(
  webhook: { endpoint: string },
  updates: T,
) {
  return {
    ...updates,
    ...(updates.endpoint &&
      updates.endpoint !== webhook.endpoint && {
        consecutiveFailures: 0,
        disabled: false,
      }),
  };
}

// Each webhook change takes only its own permission, as on the direct
// create/update/delete endpoints.
export function assertCanChangeSdkWebhooks<T extends { id: string }>(
  context: Context,
  scope: Pick<SDKConnectionInterface, "projects" | "environment">,
  before: T[],
  after: T[],
): void {
  const beforeById = new Map(before.map((w) => [w.id, w]));
  const afterIds = new Set(after.map((w) => w.id));
  const creates = after.some((w) => !beforeById.has(w.id));
  const updates = after.some((w) => {
    const old = beforeById.get(w.id);
    return !!old && !isEqual(old, w);
  });
  const deletes = before.some((w) => !afterIds.has(w.id));
  // The webhook model's own writes take this too. Asked here, a publish is
  // refused before anything is claimed, not partway through landing.
  if (
    (creates || updates || deletes) &&
    !context.permissions.canManageLegacySDKWebhooks()
  ) {
    context.permissions.throwPermissionError();
  }
  if (
    (creates && !context.permissions.canCreateSDKWebhook(scope)) ||
    (updates && !context.permissions.canUpdateSDKWebhook(scope)) ||
    (deletes && !context.permissions.canDeleteSDKWebhook(scope))
  ) {
    context.permissions.throwPermissionError();
  }
}
