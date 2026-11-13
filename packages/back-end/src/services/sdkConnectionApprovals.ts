import { isEqual } from "lodash";
import {
  getSdkConnectionGoverningRules,
  getSdkConnectionReviewRules,
} from "shared/enterprise";
import type { ApprovalFlowConfiguration } from "shared/types/organization";
import type { SDKConnectionRevisionSnapshot } from "shared/validators";
import type { SDKConnectionInterface } from "shared/types/sdk-connection";
import type { WebhookInterface } from "shared/types/webhook";
import type { Context } from "back-end/src/models/BaseModel";
import { BadRequestError } from "back-end/src/util/errors";

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
  baseline: SDKConnectionRevisionSnapshot,
  connectionId: string,
): Promise<void> {
  if (
    await context.models.revisions.hasPublishLockingScheduledSibling(
      {
        type: "sdk-connection",
        id: connectionId,
        snapshot: baseline,
        proposedChanges: [],
      },
      "",
    )
  ) {
    throw new BadRequestError(
      "Another draft of this SDK connection has a scheduled publish that locks other drafts. Cancel that schedule to publish this change.",
    );
  }
}

// The webhook endpoints write live directly, so under an approval rule the
// change has to go through a draft of the connection instead.
// REST callers pass `restBypass`, the org's REST setting, and may also bypass
// with their own permission, as the REST settings endpoint allows.
export function assertSdkWebhooksEditableDirectly(
  context: Context,
  connections: SDKConnectionInterface[],
  restBypass?: boolean,
): void {
  const gated = connections.filter((c) => isSdkConnectionGated(context, c));
  if (!gated.length) return;
  if (
    restBypass !== undefined &&
    (restBypass ||
      gated.every((c) =>
        context.permissions.canBypassSDKConnectionApprovalChecks({
          projects: c.projects,
        }),
      ))
  ) {
    return;
  }
  throw new BadRequestError(
    "This SDK connection requires approval. Change its webhooks in a draft revision.",
  );
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
  if (
    (creates && !context.permissions.canCreateSDKWebhook(scope)) ||
    (updates && !context.permissions.canUpdateSDKWebhook(scope)) ||
    (deletes && !context.permissions.canDeleteSDKWebhook(scope))
  ) {
    context.permissions.throwPermissionError();
  }
}
