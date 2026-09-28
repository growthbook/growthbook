import { createContext, useContext, useState } from "react";
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
import { useManagedFlagRename } from "@/components/Experiment/ManagedFlagRename";
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
  const unmanaged = linkedFeatures.filter(
    (f) => !isManagedByExperiment(f.feature, experiment.id),
  );
  // A flag whose removal is waiting on a draft leaves once that publishes.
  const flagIds = unmanaged
    .filter((f) => !f.pendingRemoval)
    .map((f) => f.feature.id);
  const leaving = unmanaged.flatMap((f) =>
    f.pendingRemoval
      ? [`Revision ${f.pendingRemoval.version} of ${f.feature.id}`]
      : [],
  );
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
  const actions = [
    ...(blockers.length ? [`remove ${joinAnd(blockers)}`] : []),
    ...(leaving.length
      ? [
          leaving.length > 2
            ? `publish the drafts removing ${leaving.length} Feature Flags`
            : `publish ${joinAnd(leaving)}`,
        ]
      : []),
  ];
  // Both apply: an implementation outlives setting the status back.
  if (experiment.status !== "draft") {
    return `${joinAnd(["Set the experiment's status back to Draft", ...actions])} to change its type.`;
  }
  if (!actions.length) return null;
  const sentence = joinAnd(actions);
  return `${sentence[0].toUpperCase()}${sentence.slice(1)} first.`;
}

// "a", "a and b", "a, b and c".
function joinAnd(parts: string[]): string {
  return parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Opens the page's implementation type chooser, optionally on a given type;
 * null where the type can't be changed from here.
 */
export const ImplementationTypeChooserContext = createContext<
  ((initialType?: ImplementationType) => void) | null
>(null);

export function useImplementationTypeChooser() {
  return useContext(ImplementationTypeChooserContext);
}

export default function ChangeImplementationTypeModal({
  experiment,
  managedFeature,
  lockedReason = null,
  initialType,
  draft,
  close,
}: {
  experiment: ExperimentInterfaceStringDates;
  managedFeature: LinkedFeatureInfo | null;
  /** Why the type can't change right now; shown in place of the choice. */
  lockedReason?: string | null;
  /** Preselected, for an action that names the change, such as converting the managed flag. */
  initialType?: ImplementationType;
  /** Staged for the page's Save, with whatever it does to the managed flag. */
  draft: ImplementationTypeDraft;
  close: () => void;
}) {
  const permissionsUtil = usePermissionsUtil();
  const allEnvironments = useEnvironments();
  // Experiments adopted before the type was stored only carry the flag's marker.
  const current = managedFeature ? "values" : getImplementationType(experiment);
  // Every kind it has, so a mix reads as several rather than none.
  const kinds: ImplementationType[] = [
    ...(managedFeature ? (["values"] as const) : []),
    ...((experiment.linkedFeatures ?? []).some(
      (id) => id !== managedFeature?.feature.id,
    )
      ? (["feature"] as const)
      : []),
    ...(experiment.hasVisualChangesets ? (["visual"] as const) : []),
    ...(experiment.hasURLRedirects ? (["urlredirect"] as const) : []),
  ];
  const currentKinds = new Set(kinds.length ? kinds : current ? [current] : []);
  const shown = draft.value?.type ?? current;
  const [next, setNext] = useState<ImplementationType | "">(
    // A locked type opens on what it is, not on a change it can't make.
    (lockedReason ? undefined : initialType) ??
      (shown && SELECTABLE_IMPLEMENTATION_TYPES.includes(shown) ? shown : ""),
  );
  const [acknowledged, setAcknowledged] = useState(false);

  const changed = !!next && next !== current;
  const ejectsManagedFlag = !!managedFeature && changed && next === "feature";
  const removesManagedFlag =
    !!managedFeature && changed && next !== "feature" && next !== "values";
  const managedKey = managedFeature?.feature.id;
  // Converting ends the rename's flag as a managed one, so a staged rename goes.
  const { featureId: stagedKey, staged: renameStaged } = useManagedFlagRename(
    managedKey ?? "",
  );
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
            badge: currentKinds.has(type) ? "Current" : undefined,
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
          stays linked to this experiment as a regular Feature Flag. You can
          still set its values here and edit the rest from the Feature Flag.
          {renameStaged ? ` The staged rename to ${stagedKey} is dropped.` : ""}
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
