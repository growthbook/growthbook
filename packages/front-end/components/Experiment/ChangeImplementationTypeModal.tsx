import { useState } from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ImplementationType } from "shared/validators";
import {
  getImplementationType,
  isManagedByExperiment,
  SELECTABLE_IMPLEMENTATION_TYPES,
} from "shared/util";
import { ImplementationTypeDraft } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioCards from "@/ui/RadioCards";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import { IMPLEMENTATION_TYPE_OPTIONS } from "@/components/Experiment/ImplementationTypeSelect";

/**
 * Why the implementation type can't change right now, or null when it can. The
 * change flow handles the managed flag itself; anything else linked blocks it.
 */
export function implementationTypeLockedReason(
  experiment: ExperimentInterfaceStringDates,
  linkedFeatures: LinkedFeatureInfo[],
): string | null {
  if (experiment.status !== "draft") {
    return "Set the experiment's status back to Draft to change its type.";
  }
  const flagIds = linkedFeatures
    .filter((f) => !isManagedByExperiment(f.feature, experiment.id))
    .map((f) => f.feature.id);
  // Names what's in the way, so the fix is obvious.
  const blockers = [
    ...(flagIds.length === 1
      ? [`the linked Feature Flag ${flagIds[0]}`]
      : flagIds.length === 2
        ? [`the linked Feature Flags ${flagIds[0]} and ${flagIds[1]}`]
        : flagIds.length > 2
          ? [`the ${flagIds.length} linked Feature Flags`]
          : []),
    ...(experiment.hasVisualChangesets ? ["the Visual Editor changes"] : []),
    ...(experiment.hasURLRedirects ? ["the URL Redirects"] : []),
  ];
  if (!blockers.length) return null;
  const list =
    blockers.length === 1
      ? blockers[0]
      : `${blockers.slice(0, -1).join(", ")} and ${blockers[blockers.length - 1]}`;
  return `Remove ${list} first.`;
}

export default function ChangeImplementationTypeModal({
  experiment,
  managedFeature,
  lockedReason = null,
  draft,
  close,
}: {
  experiment: ExperimentInterfaceStringDates;
  managedFeature: LinkedFeatureInfo | null;
  /** Why the type can't change right now; shown in place of the choice. */
  lockedReason?: string | null;
  /** Staged for the page's Save, with whatever it does to the managed flag. */
  draft: ImplementationTypeDraft;
  close: () => void;
}) {
  const permissionsUtil = usePermissionsUtil();
  const allEnvironments = useEnvironments();
  // Experiments adopted before the type was stored only carry the flag's marker.
  const current = managedFeature ? "values" : getImplementationType(experiment);
  const shown = draft.value?.type ?? current;
  const [next, setNext] = useState<ImplementationType | "">(
    shown && SELECTABLE_IMPLEMENTATION_TYPES.includes(shown) ? shown : "",
  );
  const [acknowledged, setAcknowledged] = useState(false);

  const changed = !!next && next !== current;
  const ejectsManagedFlag = !!managedFeature && changed && next === "feature";
  const removesManagedFlag =
    !!managedFeature && changed && next !== "feature" && next !== "values";
  const managedKey = managedFeature?.feature.id;
  const managedEnvs = managedFeature
    ? getEnabledEnvironments(managedFeature.feature, allEnvironments)
    : [];
  // The server takes publish authority to convert and delete authority to remove.
  const blockedReason =
    ejectsManagedFlag &&
    managedFeature &&
    !permissionsUtil.canPublishFeature(managedFeature.feature, managedEnvs)
      ? "Converting the Feature Flag requires permission to publish it."
      : removesManagedFlag &&
          managedFeature &&
          !permissionsUtil.canDeleteFeature(managedFeature.feature, managedEnvs)
        ? "Removing the Feature Flag requires permission to delete it."
        : null;

  return (
    <ModalStandard
      open={true}
      close={close}
      trackingEventModalType="change-implementation-type"
      header="Change Implementation Type"
      cta="Apply"
      ctaEnabled={
        !lockedReason &&
        !!next &&
        next !== shown &&
        !blockedReason &&
        (!removesManagedFlag || acknowledged)
      }
      // The save converts or deletes the managed flag as part of the change;
      // the checkbox is the acknowledgement it needs before deleting.
      submit={() =>
        draft.set(
          changed && next
            ? { type: next, deletesManagedFlag: removesManagedFlag }
            : null,
        )
      }
    >
      <Text as="p" color="text-mid" mb="3">
        Choose how this experiment delivers its variations.
      </Text>
      {lockedReason ? (
        <Callout status="info" mb="3">
          {lockedReason}
        </Callout>
      ) : null}
      <RadioCards
        width="100%"
        disabled={!!lockedReason}
        value={next}
        setValue={(v) => {
          setNext(v as ImplementationType);
          setAcknowledged(false);
        }}
        labelSize="md"
        descriptionSize="sm"
        options={SELECTABLE_IMPLEMENTATION_TYPES.map((type) => {
          const option = IMPLEMENTATION_TYPE_OPTIONS[type];
          return {
            value: type,
            label: option.header,
            description: option.description,
            avatar: (
              <Avatar
                radius="small"
                color={option.color}
                size="sm"
                variant="soft"
              >
                {option.icon}
              </Avatar>
            ),
            badge: type === current ? "Current" : undefined,
          };
        })}
      />
      {blockedReason && (
        <Callout status="error" mt="3">
          {blockedReason}
        </Callout>
      )}
      {ejectsManagedFlag && !blockedReason && (
        <Callout status="info" mt="3">
          <span style={{ fontFamily: "var(--code-font-family)" }}>
            {managedKey}
          </span>{" "}
          becomes an unmanaged linked Feature Flag, edited from its own page.
        </Callout>
      )}
      {removesManagedFlag && !blockedReason && (
        <Callout status="warning" mt="3">
          <Text as="p" mb="3">
            This deletes the managed Feature Flag{" "}
            <span style={{ fontFamily: "var(--code-font-family)" }}>
              {managedKey}
            </span>{" "}
            and its pending values. Unsaved edits to its values or key on this
            page are discarded.
          </Text>
          <Checkbox
            label="Delete the Feature Flag"
            weight="regular"
            value={acknowledged}
            setValue={(v) => setAcknowledged(!!v)}
          />
        </Callout>
      )}
    </ModalStandard>
  );
}
