import { ConfigInterface } from "shared/types/config";
import { SavedGroupInterface } from "shared/types/saved-group";
import type { Revision } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import { getAdapter } from "back-end/src/revisions";
import {
  collectConfigPublishHookGates,
  collectConfigPublishValueGates,
} from "back-end/src/services/configValidation";
import { collectConfigLockGate } from "back-end/src/services/configLock";
import { collectSavedGroupArchiveDependentsGate } from "back-end/src/services/archiveDependentsGuard";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { makeGenericBulkAdapter } from "back-end/src/revisions/bulkPublish/genericBulkAdapter";
import { featureBulkAdapter } from "back-end/src/revisions/bulkPublish/featureBulkAdapter";
import type { BulkPublishableAdapter } from "back-end/src/revisions/bulkPublish/BulkPublishableAdapter";
import type { BulkPublishTargetType } from "back-end/src/revisions/bulkPublish/types";

// Gates the single-entity REST handlers assemble inline (rather than via the
// adapters' collectPublishGates), contributed here so bulk plans enforce the
// same conditions. Consolidating these into one shared per-entity builder used
// by both surfaces is tracked follow-up work.

async function configExtraGates(args: {
  overlayContext: Context;
  entity: Record<string, unknown>;
  revision: Revision;
  desiredState: Record<string, unknown>;
}): Promise<PublishGate[]> {
  const config = args.entity as unknown as ConfigInterface;
  const gates: PublishGate[] = [...collectConfigLockGate(config)];
  // Custom validation hooks — evaluated against the overlay so hooks judge the
  // multi-entity end-state, matching where the value validation runs.
  gates.push(
    ...(await collectConfigPublishHookGates({
      context: args.overlayContext,
      config,
      desiredState: args.desiredState,
      revision: args.revision,
    })),
  );
  // The publish-time safety net the single-entity handler runs after its
  // gates: post-publish value conformance against the effective schema
  // (catches pre-existing violations the introduced-violation diff suppresses).
  gates.push(
    ...(await collectConfigPublishValueGates({
      context: args.overlayContext,
      config,
      desiredState: args.desiredState,
    })),
  );
  return gates;
}

async function savedGroupExtraGates(args: {
  callerContext: Context;
  entity: Record<string, unknown>;
  desiredState: Record<string, unknown>;
}): Promise<PublishGate[]> {
  return collectSavedGroupArchiveDependentsGate(
    args.callerContext,
    args.entity as unknown as SavedGroupInterface,
    args.desiredState,
  );
}

const registry: Record<BulkPublishTargetType, () => BulkPublishableAdapter> = {
  "saved-group": () =>
    makeGenericBulkAdapter("saved-group", getAdapter("saved-group"), {
      extraGates: savedGroupExtraGates,
    }),
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
