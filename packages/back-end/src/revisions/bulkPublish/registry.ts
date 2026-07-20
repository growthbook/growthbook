import { isConfigLocked } from "shared/util";
import { ConfigInterface } from "shared/types/config";
import { getAdapter } from "back-end/src/revisions";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { makeGenericBulkAdapter } from "back-end/src/revisions/bulkPublish/genericBulkAdapter";
import { featureBulkAdapter } from "back-end/src/revisions/bulkPublish/featureBulkAdapter";
import type { BulkPublishableAdapter } from "back-end/src/revisions/bulkPublish/BulkPublishableAdapter";
import type { BulkPublishTargetType } from "back-end/src/revisions/bulkPublish/types";

// The config REST publish handler assembles the config-locked gate inline;
// contribute the same gate here so bulk plans report it identically. Locked
// configs are never publishable-over (the unlock endpoint is the resolution).
async function configExtraGates(args: {
  entity: Record<string, unknown>;
}): Promise<PublishGate[]> {
  const config = args.entity as unknown as ConfigInterface;
  if (!isConfigLocked(config)) return [];
  return [
    {
      type: "config-locked",
      severity: "blocker",
      messages: [
        `Config "${config.key}" is locked at revision v${config.lock?.version}. Unlock it before publishing.`,
      ],
      override: null,
      requiresPermission: null,
      resolution: {
        action: "unlock",
        method: "POST",
        path: `/configs/${config.key}/unlock`,
      },
    },
  ];
}

const registry: Record<BulkPublishTargetType, () => BulkPublishableAdapter> = {
  "saved-group": () =>
    makeGenericBulkAdapter("saved-group", getAdapter("saved-group")),
  constant: () => makeGenericBulkAdapter("constant", getAdapter("constant")),
  config: () =>
    makeGenericBulkAdapter("config", getAdapter("config"), {
      extraGates: configExtraGates,
    }),
  feature: () => featureBulkAdapter,
};

export function getBulkAdapter(
  type: BulkPublishTargetType,
): BulkPublishableAdapter {
  return registry[type]();
}
