import { ConfigInterface } from "shared/types/config";
import { ConstantInterface } from "shared/types/constant";
import { Revision } from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import {
  assertConfigExperimentGuard,
  assertConstantExperimentGuard,
} from "back-end/src/services/experimentGuard";
import { assertConfigLockGuard } from "back-end/src/services/configLockGuard";
import {
  assertConstantSchemaBreakGuard,
  assertConfigSchemaBreakGuard,
  assertConfigArchiveSchemaBreakGuard,
} from "back-end/src/services/schemaBreakGuard";
import {
  assertConfigArchiveDependentsGuard,
  assertConstantArchiveDependentsGuard,
} from "back-end/src/services/archiveDependentsGuard";

// Every deferred-publish guard for a config/constant publish, orchestrated in one
// place so each choke point (REST publish/update/revert handlers, the internal
// controllers, and the revision adapters) stays in lockstep as guards are added.
// Callers gate on a value-affecting change before invoking — a metadata-only
// publish can't disrupt any guard. Guards run sequentially: a synchronous
// ignoreWarnings/bypass clears all of them at once, and any armed (deferred)
// fingerprint mismatch is terminal regardless of order.

export async function assertConfigPublishGuards(
  context: Context,
  config: ConfigInterface,
  revision: Pick<Revision, "armAcknowledgments">,
  opts: { armed: boolean },
  // The config's proposed (being-published) state, for the schema-break guard.
  // Its own value/schema/lineage after the merge — resolved + checked across
  // environments. Omit when unknown; the guard then skips (fail-open).
  proposedConfig?: Pick<
    ConfigInterface,
    "value" | "schema" | "parent" | "extends" | "extensible"
  >,
  // The proposed archived state when this publish is an archive/unarchive
  // transition. Resolution scrubs archived entries, so the flip rewrites
  // dependents' resolved values even though the config's own value is unchanged
  // — the schema-break guard models the transition against them. Omit for a
  // value publish.
  proposedArchived?: boolean,
): Promise<void> {
  await assertConfigExperimentGuard(context, config, revision, opts);
  await assertConfigLockGuard(
    context,
    { source: "config", key: config.key, project: config.project },
    revision,
    opts,
  );
  if (
    proposedArchived !== undefined &&
    !!config.archived !== proposedArchived
  ) {
    await assertConfigArchiveSchemaBreakGuard(
      context,
      config,
      proposedArchived,
      opts,
      revision,
    );
    // Only the archive direction is guarded for live dependents; unarchiving
    // never breaks a dependent (it restores a value).
    if (proposedArchived) {
      await assertConfigArchiveDependentsGuard(
        context,
        {
          id: config.id,
          key: config.key,
          project: config.project,
          // Fingerprint the PROPOSED value/lineage — the same state the arm-time
          // capture used (config.adapter builds `proposedConfig` identically at
          // arm and fire). A revision that flips `archived` AND changes
          // value/parent/extends in one shot would otherwise fingerprint the
          // proposed state at arm but re-check the stale live state at fire —
          // bricking the deferred publish (spurious NEW dependent) or masking a
          // real one. Fall back to the live values on direct paths that omit
          // proposedConfig (a pure archive doesn't touch them anyway).
          value: proposedConfig?.value ?? config.value,
          parent: proposedConfig?.parent ?? config.parent,
          extends: proposedConfig?.extends ?? config.extends,
        },
        opts,
        revision,
      );
    }
  }
  if (proposedConfig) {
    await assertConfigSchemaBreakGuard(
      context,
      {
        key: config.key,
        project: config.project,
        value: proposedConfig.value,
        schema: proposedConfig.schema,
        parent: proposedConfig.parent,
        extends: proposedConfig.extends,
        extensible: proposedConfig.extensible,
      },
      opts,
      revision,
    );
  }
}

export async function assertConstantPublishGuards(
  context: Context,
  constant: ConstantInterface,
  revision: Pick<Revision, "armAcknowledgments">,
  opts: { armed: boolean },
  // The constant's proposed (being-published) base value + per-environment
  // values, for the schema-break guard (a per-env value change breaks a
  // dependent config only in that environment). Omit when unknown — the guard
  // then skips (fail-open, soft warning).
  proposedValue?: string,
  proposedEnvironmentValues?: Record<string, string>,
  // The proposed archived state for an archive/unarchive transition — archived
  // references are scrubbed at resolution, so the flip rewrites dependents'
  // resolved values even with the constant's own values unchanged. Omit for a
  // value publish.
  proposedArchived?: boolean,
): Promise<void> {
  await assertConstantExperimentGuard(context, constant, revision, opts);
  await assertConfigLockGuard(
    context,
    { source: "constant", key: constant.key, project: constant.project },
    revision,
    opts,
  );
  await assertConstantSchemaBreakGuard(
    context,
    { key: constant.key, project: constant.project },
    proposedValue,
    opts,
    revision,
    proposedEnvironmentValues,
    proposedArchived,
  );
  // Only the archive direction is guarded for live dependents; unarchiving
  // restores values and never breaks a dependent.
  if (proposedArchived === true && !constant.archived) {
    await assertConstantArchiveDependentsGuard(
      context,
      { id: constant.id, key: constant.key, project: constant.project },
      opts,
      revision,
    );
  }
}
