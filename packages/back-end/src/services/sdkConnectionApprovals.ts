import { getSdkConnectionGoverningRules } from "shared/enterprise";
import type { SDKConnectionInterface } from "shared/types/sdk-connection";
import type { ReqContext } from "back-end/types/request";
import { BadRequestError } from "back-end/src/util/errors";

// The webhook endpoints write live directly, so under an approval rule the
// change has to go through a draft of the connection instead.
export function assertSdkWebhooksEditableDirectly(
  context: ReqContext,
  connections: SDKConnectionInterface[],
): void {
  if (!context.hasPremiumFeature("require-approvals")) return;
  const gated = connections.some(
    (c) =>
      getSdkConnectionGoverningRules(context.org.settings?.approvalFlows, {
        projects: c.projects,
        environment: c.environment,
      }).length > 0,
  );
  if (gated) {
    throw new BadRequestError(
      "This SDK connection requires approval. Change its webhooks in a draft revision.",
    );
  }
}
