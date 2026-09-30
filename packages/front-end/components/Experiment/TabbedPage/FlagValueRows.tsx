import clsx from "clsx";
import {
  forwardRef,
  HTMLAttributes,
  ReactNode,
  useMemo,
  useState,
} from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { FeatureInterface, FeatureValueType } from "shared/types/feature";
import {
  castFeatureValue,
  getConfigSubtree,
  getFeatureBaseConfigKey,
  getImplementationType,
  isManagedByExperiment,
  managedFeatureKeyCandidate,
  parsePlainJSONObject,
  seedManagedVariationValues,
} from "shared/util";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import {
  PiArrowSquareOut,
  PiCaretDownFill,
  PiFlag,
  PiPencilSimple,
  PiWarningFill,
} from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import ForceSummary from "@/components/Features/ForceSummary";
import FeatureValueField from "@/components/Features/FeatureValueField";
import {
  EnvironmentInputsPopover,
  environmentStateTense,
  getEnvironmentStates,
  stageEnvironmentInputs,
  statesFromInputs,
} from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import EditExperimentEnvironmentsModal from "@/components/Experiment/EditExperimentEnvironmentsModal";
import {
  VARIATION_GRID_COLUMNS,
  variationGridMaxWidth,
} from "@/components/Experiment/VariationsTable";
import RevisionLabel from "@/components/Reviews/RevisionLabel";
import RevisionStatusBadge, {
  revisionStatusLabel,
  type RevisionLike,
} from "@/components/Reviews/RevisionStatusBadge";
import ReviewFeedbackPopover from "@/components/Reviews/ReviewFeedbackPopover";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import VariationNumber from "@/ui/VariationNumber";
import ImplementationHeading from "@/components/Experiment/ImplementationHeading";
import { useManagedFlagRename } from "@/components/Experiment/ManagedFlagRename";
import {
  implementationTypeLockedReason,
  useImplementationTypeChooser,
} from "@/components/Experiment/ChangeImplementationTypeModal";
import { ActionsOverlay } from "@/components/Features/CornerActions";
import {
  blockedExperimentValueTypes,
  EXPERIMENT_VALUE_TYPE_ORDER,
  VALUE_TYPE_LABELS,
} from "@/components/Features/valueTypes";
import cornerStyles from "@/components/Features/CornerActions.module.scss";
import { draftApprovalSatisfied } from "@/components/Reviews/reviewAndPublishState";
import {
  FlagEnvironmentsDraft,
  useLiveView,
  useRegisterExperimentEdit,
} from "./ExperimentEdits";
import {
  canStartSeparateDraft,
  FlagDraftPicks,
  resolveDraftPick,
} from "./draftPicks";
import FlagValuesModal from "./FlagValuesModal";
import { AddImplementationButton } from "./ImplementationCard";
import {
  getDuplicateVariationIds,
  repairVariationValues,
  variationLabel,
} from "./variationValues";
import styles from "./FlagValueRows.module.scss";

const JSON_ACTIONS: ActionsOverlay = {
  revealOnHover: true,
  style: { bottom: -9, right: 2, gap: "var(--space-2)" },
};
// A read-only one-liner has no corner to spare, so copy sits at its end.
const ONE_LINE_ACTIONS: ActionsOverlay = {
  revealOnHover: true,
  style: {
    top: "50%",
    bottom: "auto",
    right: 2,
    transform: "translateY(-50%)",
  },
};
const STRING_ACTIONS: ActionsOverlay = {
  revealOnHover: true,
  style: { bottom: 0, right: 18 },
};
// A managed value has no room beside it, so the constant picker joins copy.
const MANAGED_STRING_ACTIONS: ActionsOverlay = {
  ...STRING_ACTIONS,
  withConstantButton: true,
};

// A slim, underlined menu trigger: the current choice and a caret. A menu or
// tooltip hands its trigger handlers and a ref, so they land on the span.
const CaretTrigger = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement> & { color?: "dark"; size?: "sm" | "md" }
>(function CaretTrigger({ children, color, size = "sm", ...props }, ref) {
  return (
    <span ref={ref} {...props}>
      <Link color={color} underline="none" className={styles.caretTrigger}>
        <Flex align="center" gap="1">
          <Text size={size}>{children}</Text>
          <PiCaretDownFill size={10} />
        </Flex>
      </Link>
    </span>
  );
});

type Staged = {
  values: Record<string, string>;
  valueType?: FeatureValueType;
  sparse?: boolean;
};

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  canEdit: boolean;
  /** Whether flags can be removed or kept, which the Live view doesn't stop. */
  canEditLinks?: boolean;
  /** Show what is live rather than the draft, read-only. */
  showLive?: boolean;
  /** Links another Feature Flag, offered under the last one. */
  onAddFlag?: (() => void) | null;
  /** Why another Feature Flag can't be added right now. */
  addFlagBlockedReason?: string | null;
  /** Environment scopes staged per flag. */
  flagEnvironments?: FlagEnvironmentsDraft;
  draftPicks: FlagDraftPicks;
  /** A Values experiment without its flag: the values edit as usual and create it on save. */
  pendingManagedFlag?: boolean;
}

// Stands in for the flag a Values experiment creates on save, so its values
// edit like the real one's. Only what the row reads is filled in.
function pendingManagedFlagInfo(
  experiment: ExperimentInterfaceStringDates,
): LinkedFeatureInfo {
  const feature = {
    id: managedFeatureKeyCandidate({
      trackingKey: experiment.trackingKey,
      experimentId: experiment.id,
    }),
    project: experiment.project ?? "",
    valueType: "string",
    defaultValue: "",
    version: 0,
    environmentSettings: {},
    managedBy: { type: "experiment", experimentId: experiment.id },
  } as FeatureInterface;
  return {
    feature,
    state: "draft",
    values: seedManagedVariationValues(getLatestPhaseVariations(experiment)),
    valuesFrom: "",
    inconsistentValues: false,
    rulesAbove: false,
    environmentStates: {},
  };
}

/** Where the pre-launch checklist sends you to fill in values. */
export const FLAG_VALUES_ID = "experiment-flag-values";

/** One row per linked Feature Flag, a cell per variation, under the variation cards. */
export default function FlagValueRows({
  experiment,
  linkedFeatures,
  canEdit,
  canEditLinks = false,
  showLive = false,
  onAddFlag,
  addFlagBlockedReason = null,
  flagEnvironments,
  draftPicks,
  pendingManagedFlag = false,
}: Props) {
  const variations = getLatestPhaseVariations(experiment);
  const cols = Math.min(variations.length, 3);
  const chooseType = useImplementationTypeChooser();
  const pendingInfo = useMemo(
    () => (pendingManagedFlag ? pendingManagedFlagInfo(experiment) : null),
    [pendingManagedFlag, experiment],
  );

  // With nothing linked yet, the heading alone still carries the type menu.
  const implementationType = getImplementationType(experiment);
  const headingOnly =
    !!chooseType &&
    experiment.status === "draft" &&
    !linkedFeatures.length &&
    !pendingInfo &&
    !onAddFlag &&
    (implementationType === "feature" || implementationType === "values");

  if (
    (!linkedFeatures.length && !pendingInfo && !onAddFlag && !headingOnly) ||
    !variations.length
  ) {
    return null;
  }

  // The type chooser opens locked here; converting would only show the lock.
  const typeLocked = !!implementationTypeLockedReason(
    experiment,
    linkedFeatures,
  );
  const managedFlags = pendingInfo
    ? [pendingInfo]
    : linkedFeatures.filter((info) =>
        isManagedByExperiment(info.feature, experiment.id),
      );
  const linkedFlags = linkedFeatures.filter(
    (info) => !managedFlags.includes(info),
  );

  return (
    <Flex
      id={FLAG_VALUES_ID}
      direction="column"
      gap="4"
      mt="4"
      mx="auto"
      width="100%"
      style={{ maxWidth: variationGridMaxWidth(cols) }}
    >
      {managedFlags.map((info) => (
        <FlagValueRow
          key={info.feature.id}
          experiment={experiment}
          info={info}
          pending={info === pendingInfo}
          typeLocked={typeLocked}
          canEdit={canEdit}
          canEditLinks={canEditLinks}
          showLive={showLive}
          flagEnvironments={flagEnvironments}
          draftPicks={draftPicks}
        />
      ))}
      {headingOnly && implementationType === "values" ? (
        <ImplementationHeading>Values</ImplementationHeading>
      ) : null}
      {linkedFlags.length ||
      onAddFlag ||
      (headingOnly && implementationType === "feature") ? (
        <ImplementationHeading>Feature Flags</ImplementationHeading>
      ) : null}
      {linkedFlags.map((info) => (
        <FlagValueRow
          key={info.feature.id}
          experiment={experiment}
          info={info}
          canEdit={canEdit}
          canEditLinks={canEditLinks}
          showLive={showLive}
          flagEnvironments={flagEnvironments}
          draftPicks={draftPicks}
        />
      ))}
      {onAddFlag ? (
        <Flex justify="end">
          <AddImplementationButton
            label="Add Feature Flag"
            onClick={onAddFlag}
            disabledReason={addFlagBlockedReason}
          />
        </Flex>
      ) : null}
    </Flex>
  );
}

function FlagValueRow({
  experiment,
  info,
  canEdit,
  canEditLinks,
  showLive,
  flagEnvironments,
  draftPicks,
  pending = false,
  typeLocked = false,
}: {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  /** Not created yet: saving the values creates it. */
  pending?: boolean;
  /** The implementation type can't change right now. */
  typeLocked?: boolean;
  canEdit: boolean;
  canEditLinks: boolean;
  showLive: boolean;
  flagEnvironments?: FlagEnvironmentsDraft;
  draftPicks: FlagDraftPicks;
}) {
  const permissionsUtil = usePermissionsUtil();
  const { setLive } = useLiveView();
  const [editEnvironments, setEditEnvironments] = useState(false);
  const { configs } = useDefinitions();
  const variations = getLatestPhaseVariations(experiment);
  const { feature } = info;
  const pick = draftPicks.value[feature.id];
  const {
    drafts,
    draft: pendingDraft,
    target,
    launches: isLaunchDraft,
  } = useMemo(
    () => resolveDraftPick(info, pick, experiment.id),
    [info, pick, experiment.id],
  );

  const managed = isManagedByExperiment(feature, experiment.id);
  const chooseType = useImplementationTypeChooser();
  const { edit: renameFlag } = useManagedFlagRename(feature.id);
  // Not once the conversion is itself what's staged.
  const convertible =
    !!chooseType &&
    managed &&
    experiment.implementationType !== "feature" &&
    !typeLocked;
  // Where Save writes, whichever view is showing.
  const writesToDraft = !!pendingDraft && target === "draft";
  const workingOn = writesToDraft ? pendingDraft.version : "new";
  // What the row shows: the Live view shows what's published.
  const fromDraft = writesToDraft && !showLive;
  // Its rule is gone, so nothing edits here until it's linked again.
  const orphaned = info.state === "discarded";
  // Live has no rule for this experiment; only a draft links it.
  const absentFromLive = showLive && !info.liveHasMatchingRule;
  // Staged for the page's Save: link the flag again, or take it off.
  const [linkAction, setLinkAction] = useState<
    "relink" | "remove" | "keep" | null
  >(null);
  const relinking = linkAction === "relink";
  const removing = linkAction === "remove";
  // A draft is taking the live rule out; the flag leaves when it publishes.
  const pendingRemoval = info.pendingRemoval;
  const liveValues = info.liveValues ?? info.values;
  const liveSparse = info.liveSparse ?? info.sparse ?? false;
  // Linking again starts from the rule the discarded draft left, when it can.
  const values = relinking
    ? (info.relinkFrom?.values ??
      seedManagedVariationValues(variations, feature.valueType))
    : writesToDraft
      ? pendingDraft.values
      : liveValues;
  const storedSparse = relinking
    ? !!info.relinkFrom?.sparse
    : writesToDraft
      ? pendingDraft.sparse
      : liveSparse;
  const storedType = writesToDraft ? pendingDraft.valueType : feature.valueType;
  const storedDefault = writesToDraft
    ? pendingDraft.defaultValue
    : feature.defaultValue;

  // Edits belong to the draft they were made in; if it goes, so do they.
  const [stagedFor, setStaged] = useState<
    (Staged & { for: number | "new" }) | null
  >(null);
  const staged = stagedFor?.for === workingOn ? stagedFor : null;
  const pinTarget = (next: number | "new") =>
    draftPicks.set(feature.id, {
      newestVersion: drafts[0]?.version ?? null,
      target: next,
    });
  const chooseTarget = (next: number | "new") => {
    pinTarget(next);
    setStaged(null);
  };
  // Environments are staged above the row: the funnel's header edits them too.
  const stagedScope = flagEnvironments?.value[feature.id] ?? null;
  const clearStaged = () => {
    setStaged(null);
    flagEnvironments?.set(feature.id, null);
  };
  // The variation to focus when the values editor opens.
  const [editingValues, setEditingValues] = useState<string | null>(null);
  const storedValue = (variationId: string) =>
    values.find((v) => v.variationId === variationId)?.value;
  const valueFor = (variationId: string) =>
    staged?.values[variationId] ?? storedValue(variationId);
  const valueType = staged?.valueType ?? storedType;
  const sparse = staged?.sparse ?? storedSparse;
  // The Live view shows what's published, leaving staged edits for Save.
  const shownValueFor = (variationId: string) =>
    showLive
      ? liveValues.find((v) => v.variationId === variationId)?.value
      : valueFor(variationId);
  const shownType = showLive ? feature.valueType : valueType;
  const shownSparse = showLive ? liveSparse : sparse;

  // A managed flag's default is its control value, so that is what the other
  // variations patch onto.
  const controlId = variations[0]?.id;
  const baseOf = (
    valueOf: (variationId: string) => string | undefined,
    defaultValue: string | undefined,
  ) =>
    (managed && controlId ? valueOf(controlId) : undefined) ??
    defaultValue ??
    "";
  const sparseBase = baseOf(valueFor, storedDefault);
  const shownSparseBase = showLive
    ? baseOf(shownValueFor, feature.defaultValue)
    : sparseBase;
  const configKey = getFeatureBaseConfigKey(feature);
  const configBackingOptionKeys = useMemo(
    () => (configKey ? getConfigSubtree(configKey, configs) : undefined),
    [configKey, configs],
  );
  // A linked flag's base is its default, which a re-type in the same edit
  // hasn't set yet; a managed flag's base is control, which it has.
  const sparseEligible =
    !configKey &&
    valueType === "json" &&
    (managed || storedType === "json") &&
    parsePlainJSONObject(sparseBase) !== null;

  // Against the type and default the values will land under.
  const displayFeature = useMemo(
    () => ({ ...feature, valueType: shownType, defaultValue: shownSparseBase }),
    [feature, shownType, shownSparseBase],
  );
  const lockedBySchedule = fromDraft && pendingDraft.lockedBySchedule;
  const onFlag = info.state === "live" || info.state === "draft";
  const editable =
    canEdit &&
    !pendingRemoval &&
    !showLive &&
    !lockedBySchedule &&
    permissionsUtil.canEditFeatureDrafts(feature) &&
    (onFlag || relinking) &&
    !removing;

  const stage = (patch: Partial<Staged>) => {
    // Holds the row on this draft even if a newer one appears meanwhile.
    if (typeof workingOn === "number" && pick?.target !== workingOn) {
      pinTarget(workingOn);
    }
    setStaged((prev) => {
      const kept = prev?.for === workingOn ? prev : null;
      return {
        for: workingOn,
        values: { ...kept?.values, ...patch.values },
        valueType: patch.valueType ?? kept?.valueType,
        sparse: patch.sparse ?? kept?.sparse,
      };
    });
  };

  // Re-express what is already there rather than clearing it.
  const changeType = (next: FeatureValueType) => {
    if (next === valueType) return;
    stage({
      valueType: next,
      values: Object.fromEntries(
        variations.map((v, i) => [
          v.id,
          castFeatureValue({
            value: valueFor(v.id) ?? "",
            from: valueType,
            to: next,
            index: i,
          }),
        ]),
      ),
    });
  };

  // Two variations serving the same thing is almost always a mistake.
  const duplicateIds = getDuplicateVariationIds(
    variations.map((v) => ({ variationId: v.id, value: shownValueFor(v.id) })),
    shownType,
    shownSparse,
    shownSparseBase,
  );

  const dirty =
    !!stagedScope ||
    (!!staged &&
      (valueType !== storedType ||
        sparse !== storedSparse ||
        Object.entries(staged.values).some(
          ([id, value]) => value !== storedValue(id),
        )));

  // Like the values modal: repair loose values in place, then ask for a
  // second save, so nothing lands that the user hasn't seen. A dry run checks
  // the repaired values and leaves the asking to the save.
  const checkedValues = ({ dryRun }: { dryRun: boolean }) => {
    const { checked, repaired } = repairVariationValues(
      { valueType, jsonSchema: feature.jsonSchema },
      variations,
      valueFor,
      (v) => `${feature.id}, ${variationLabel(v)}`,
    );
    if (!dryRun && Object.keys(repaired).length) {
      stage({ values: repaired });
      throw new Error(
        `We fixed some errors in the ${feature.id} values. If they look correct, save again.`,
      );
    }
    return checked;
  };

  useRegisterExperimentEdit(`flag:${feature.id}`, dirty && !linkAction, {
    changes: (options) =>
      pending
        ? {
            managedFlag: {
              valueType,
              variations: checkedValues(options),
              ...(sparse && { sparse }),
            },
          }
        : {
            flagValues: [
              {
                featureId: feature.id,
                variations: checkedValues(options),
                ...(valueType !== storedType && { valueType }),
                ...(sparse !== storedSparse && { sparse }),
                ...(stagedScope && { environments: stagedScope }),
                // Writes into the draft the values came from; off live, starts one.
                revision: writesToDraft
                  ? {
                      version: pendingDraft.version,
                      dateUpdated: pendingDraft.dateUpdated,
                    }
                  : { version: feature.version, dateUpdated: null },
              },
            ],
          },
    onSaved: clearStaged,
    discard: clearStaged,
  });

  const clearLinkAction = () => {
    setLinkAction(null);
    clearStaged();
  };
  useRegisterExperimentEdit(`link:${feature.id}`, !!linkAction, {
    changes: (options) =>
      removing
        ? { unlinkFeatures: [feature.id] }
        : linkAction === "keep"
          ? { keepFeatures: [feature.id] }
          : {
              linkFeatures: [
                {
                  featureId: feature.id,
                  variations: checkedValues(options),
                  ...(sparse && { sparse }),
                  ...(info.relinkFrom && {
                    environments: {
                      allEnvironments: info.relinkFrom.allEnvironments,
                      environments: info.relinkFrom.environments,
                    },
                  }),
                },
              ],
            },
    onSaved: clearLinkAction,
    discard: clearLinkAction,
  });

  // In a sentence a draft goes by its number; a title reads as more prose.
  const draftMention = pendingDraft ? `Revision ${pendingDraft.version}` : null;
  const labelFor = (d: (typeof drafts)[number]) => (
    <RevisionLabel
      version={d.version}
      title={d.title}
      numbered={!!d.title}
      minWidth={0}
      numberSize="inherit"
      inheritNumberColor
    />
  );
  const draftRevision = pendingDraft ? labelFor(pendingDraft) : null;
  const draftName = draftRevision ? (
    <Box as="span" display="block" maxWidth="180px">
      <Text size="sm" truncate>
        {draftRevision}
      </Text>
    </Box>
  ) : null;
  // Nothing to name where nobody can save: the badge already says what's live.
  const targetLabel = showLive
    ? "Live"
    : fromDraft
      ? draftName
      : editable
        ? "New draft"
        : null;
  const targetTooltip = fromDraft ? (
    <Box>
      <Text size="sm">
        {editable
          ? "Saving writes to this draft of the Feature Flag:"
          : "Showing this draft of the Feature Flag:"}
      </Text>
      <Box>
        <Text size="sm" weight="semibold">
          {draftRevision}
        </Text>
      </Box>
      {lockedBySchedule ? (
        <Box mt="1">
          <Text size="sm" color="text-low">
            Locked until its scheduled publish.
          </Text>
        </Box>
      ) : null}
    </Box>
  ) : !showLive ? (
    "Saving starts a new draft of this Feature Flag."
  ) : null;
  const canStartNew = canStartSeparateDraft(info, experiment.id) && canEdit;
  // Several drafts change this rule: pick which one the row shows and saves to.
  const canChooseTarget =
    !showLive && !!pendingDraft && (drafts.length > 1 || canStartNew);

  const targetControl = canChooseTarget ? (
    // Outside the menu: a tooltip hands its trigger's props to its content,
    // so inside it would swallow the menu's click.
    <Tooltip content={targetTooltip} enabled={!!targetTooltip}>
      <span style={{ display: "inline-flex" }}>
        <DropdownMenu
          trigger={<CaretTrigger>{targetLabel}</CaretTrigger>}
          menuPlacement="end"
          variant="soft"
        >
          {drafts.map((d) => (
            <DropdownMenuItem
              key={d.version}
              onClick={() => chooseTarget(d.version)}
            >
              {labelFor(d)}
            </DropdownMenuItem>
          ))}
          {canStartNew ? (
            <DropdownMenuItem onClick={() => chooseTarget("new")}>
              New draft
            </DropdownMenuItem>
          ) : null}
        </DropdownMenu>
      </span>
    </Tooltip>
  ) : (
    <Tooltip content={targetTooltip} enabled={!!targetTooltip}>
      {/* The trigger takes the hover handlers, so it must be a plain element. */}
      <span style={{ display: "inline-flex" }} className={styles.revisionLabel}>
        <Text size="sm" color="text-low">
          {targetLabel}
        </Text>
      </span>
    </Tooltip>
  );

  const canEditFlag =
    canEdit && !pendingRemoval && permissionsUtil.canEditFeatureDrafts(feature);
  // Removing and keeping stage from either view, so Live leaves for them.
  const canEditFlagLinks =
    canEditLinks && permissionsUtil.canEditFeatureDrafts(feature);
  const launches = experiment.status === "draft";
  // A running experiment keeps its flags until it's back in Draft.
  const removeBlocked = experiment.status === "running";
  const launchDraft = drafts[0];
  const draftLaunches = launches && isLaunchDraft;
  const stageLinkAction = (action: "relink" | "remove" | "keep") => {
    setLive(false);
    clearStaged();
    setLinkAction(action);
  };

  // Only a problem wears the warning; any other state is the revision's own.
  const shownDraft = fromDraft ? pendingDraft : null;
  const problem = shownDraft?.hasMergeConflict
    ? "Merge conflict"
    : shownDraft?.rebaseRequired
      ? "Needs rebase"
      : draftLaunches && shownDraft?.hasUnrelatedDraftChanges
        ? "Changes beyond this experiment"
        : info.state === "discarded"
          ? "Rule missing"
          : info.state === "archived"
            ? "Archived"
            : null;
  const needsApproval =
    !!shownDraft?.pendingApproval && !draftApprovalSatisfied(shownDraft);
  const reviewHref = (version: number) =>
    `/features/${feature.id}?v=${version}#review`;
  const draftHref = shownDraft
    ? reviewHref(shownDraft.version)
    : `/features/${feature.id}`;
  // The badge opens that revision's review, in a new tab like the flag's link.
  const badgeLink = (revision: RevisionLike) => (
    <Link
      href={reviewHref(revision.version)}
      external
      underline="none"
      // Led by the status it shows, so it's announced and can be spoken to.
      aria-label={`${revisionStatusLabel(
        revision.version === feature.version ? "live" : revision.status,
      )}: open the review of ${feature.id}`}
    >
      <RevisionStatusBadge revision={revision} liveVersion={feature.version} />
    </Link>
  );

  // A new tab, so following it never costs the page's unsaved edits.
  const draftLink = (label: string, href = draftHref) => (
    <Link href={href} external underline="always">
      {label}
      <PiArrowSquareOut style={{ marginLeft: "var(--space-1)" }} />
    </Link>
  );

  const notices: {
    status: "error" | "warning" | "info";
    text: ReactNode;
    action?: ReactNode;
  }[] = [];
  if (info.state === "archived") {
    notices.push(
      experiment.status === "running"
        ? {
            status: "warning",
            text: "This Feature Flag is archived, so it isn't serving this experiment. Unarchive it to serve it again.",
          }
        : launches
          ? {
              status: "warning",
              text: "This Feature Flag is archived, so it won't serve this experiment when it starts. Unarchive it first.",
            }
          : { status: "info", text: "This Feature Flag is archived." },
    );
  }
  // No live rule and no draft adding one: discarded, or published away.
  if (orphaned && !linkAction) {
    notices.push({
      status: "warning",
      text: `This experiment isn't in the live revision of this Feature Flag, and no open draft adds it${
        experiment.status === "running"
          ? ", so the Feature Flag isn't serving it"
          : ""
      }.`,
    });
  }
  // A managed flag's draft is reviewed and published through the
  // experiment's own flow, so none of the flag-page routes apply.
  if (!managed) {
    if (shownDraft?.hasMergeConflict) {
      notices.push({
        status: "error",
        text: draftLaunches
          ? "This draft conflicts with live, so the experiment can't start until that's resolved."
          : "This draft conflicts with live and can't publish until that's resolved.",
        action: draftLink("Fix conflicts"),
      });
    } else if (shownDraft?.rebaseRequired) {
      notices.push({
        status: "warning",
        text: "Live has moved on since this draft. Update it from live before it can publish.",
        action: draftLink("Review draft"),
      });
    } else if (draftLaunches && shownDraft?.hasUnrelatedDraftChanges) {
      // Only the start publishes a draft from here, so only it is blocked.
      notices.push({
        status: "error",
        text: "This draft also changes things outside this experiment, so the experiment can't start. Remove those edits, or publish the draft from the Feature Flag.",
        action: draftLink("Review draft"),
      });
    } else if (shownDraft && !lockedBySchedule) {
      notices.push({
        status: "info",
        text:
          launches && !isLaunchDraft && launchDraft
            ? `Only Revision ${launchDraft.version} publishes when the experiment starts. Publish this draft from the Feature Flag.`
            : needsApproval
              ? launches
                ? "Needs approval. Once approved, it publishes when the experiment starts."
                : "Needs approval before it can publish."
              : launches
                ? "Publishes when the experiment starts, or publish it from the Feature Flag."
                : experiment.status === "running"
                  ? "Publish it from the Feature Flag to change what this experiment serves."
                  : "Publish it from the Feature Flag.",
        action: draftLink(
          needsApproval ? "Review and approve" : "Review draft",
        ),
      });
    }
  }
  if (lockedBySchedule) {
    notices.push({
      status: "info",
      text: "Locked until its scheduled publish.",
    });
  }
  // These describe the revision the server read: the newest draft, or live.
  const describesShown = fromDraft
    ? info.state === "draft" && pendingDraft.version === drafts[0]?.version
    : info.state === "live";
  if (onFlag && describesShown && info.inconsistentValues) {
    notices.push({
      status: "warning",
      text: `This experiment is on the Feature Flag more than once with different values. Showing the first, from ${info.valuesFrom}.`,
    });
  }
  if (onFlag && describesShown && info.rulesAbove) {
    notices.push({
      status: "info",
      text: "Rules above this experiment on the Feature Flag may catch some users first.",
    });
  }

  // Like the values, the Live view leaves the staged scope for Save.
  const shownScope = showLive ? null : stagedScope;
  const storedInputs = fromDraft
    ? pendingDraft.environmentInputs
    : (info.liveEnvironmentInputs ?? info.environmentInputs);
  const environmentInputs =
    storedInputs && stageEnvironmentInputs(storedInputs, shownScope);
  const environmentStates = getEnvironmentStates(
    shownScope && environmentInputs
      ? { environmentStates: statesFromInputs(environmentInputs) }
      : fromDraft
        ? pendingDraft
        : {
            environmentStates:
              info.liveEnvironmentStates ?? info.environmentStates,
          },
    {
      future: environmentStateTense({
        status: experiment.status,
        unpublished: fromDraft || !!shownScope,
        launches: isLaunchDraft,
        liveView: showLive,
      }),
    },
  );
  // What the draft moves, against live; before live has the rule, against the
  // flag's own toggles with no rule.
  const liveInput = (env: string) =>
    info.liveEnvironmentInputs?.[env] ?? {
      flagEnabled: !!feature.environmentSettings?.[env]?.enabled,
      rule: "missing" as const,
    };
  const changedInputs = (env: string) => {
    const input = environmentInputs?.[env];
    if ((!fromDraft && !shownScope) || !input) {
      return { flag: false, rule: false };
    }
    const live = liveInput(env);
    return {
      flag: input.flagEnabled !== live.flagEnabled,
      rule: input.rule !== live.rule,
    };
  };
  const environmentsChanged = environmentStates.some(({ env }) => {
    const changed = changedInputs(env);
    return changed.flag || changed.rule;
  });
  // Only a change the draft makes needs saying when it lands.
  const environmentsTiming = !environmentsChanged
    ? null
    : `${fromDraft ? `From ${draftMention}. ` : ""}${
        draftLaunches
          ? "Takes effect when it's published, or when the experiment starts."
          : "Takes effect when it's published."
      }`;

  const linkActionNote =
    linkAction === "keep"
      ? `Kept in this experiment when you save. The rule goes back into Revision ${pendingRemoval?.version}.`
      : relinking
        ? experiment.status === "running"
          ? "Saving adds this experiment to a new draft of this Feature Flag. Publish it from the Feature Flag to serve it."
          : launches
            ? "Saving adds this experiment to a new draft of this Feature Flag, which publishes when the experiment starts."
            : "Saving adds this experiment to a new draft of this Feature Flag."
        : info.liveHasMatchingRule
          ? "When you save, a draft takes this experiment's rule out of the Feature Flag. Once it's published, the Feature Flag leaves this experiment."
          : "Removed from this experiment when you save, along with its rule in any open draft.";

  // The Live view of a flag whose live revision lacks the rule. When the
  // draft can publish is the Unpublished view's to say.
  const absentFromLiveNote = `This experiment isn't in the live revision of this Feature Flag${
    experiment.status === "running"
      ? ", so the Feature Flag isn't serving it"
      : ""
  }.${pendingDraft ? ` ${draftMention} adds it.` : ""}`;

  // JSON is too big to edit in a cell, so it opens the values editor.
  const isJson = shownType === "json";

  const typeBlocked = blockedExperimentValueTypes(variations.length);
  const valueTypeControl = editable ? (
    <DropdownMenu
      trigger={
        <CaretTrigger color="dark" size="md">
          {VALUE_TYPE_LABELS[valueType]}
        </CaretTrigger>
      }
      menuPlacement="end"
      variant="soft"
    >
      {EXPERIMENT_VALUE_TYPE_ORDER.map((t) => (
        <DropdownMenuItem
          key={t}
          disabled={!!typeBlocked[t] && t !== valueType}
          onClick={() => changeType(t)}
        >
          <Tooltip
            content={typeBlocked[t]}
            side="left"
            enabled={!!typeBlocked[t] && t !== valueType}
          >
            <span>{VALUE_TYPE_LABELS[t]}</span>
          </Tooltip>
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  ) : (
    <Text>{VALUE_TYPE_LABELS[shownType]}</Text>
  );

  return (
    <>
      {managed ? (
        <ImplementationHeading
          action={
            // Baseline, so the trigger's hover border doesn't lift its text.
            <Flex align="baseline" gap="1">
              <Text color="text-low">Type:</Text>
              {valueTypeControl}
            </Flex>
          }
          menu={
            // The heading adds "Change implementation type" below these.
            !pending && (renameFlag || convertible) ? (
              <>
                {renameFlag ? (
                  <DropdownMenuItem onClick={renameFlag}>
                    Rename flag ID
                  </DropdownMenuItem>
                ) : null}
                {renameFlag && chooseType ? <DropdownMenuSeparator /> : null}
                {convertible ? (
                  <DropdownMenuItem onClick={() => chooseType?.("feature")}>
                    Convert to unmanaged flag
                  </DropdownMenuItem>
                ) : null}
              </>
            ) : null
          }
        >
          Values
        </ImplementationHeading>
      ) : null}
      {/* The variation grid's width and columns; a managed flag's values
          stand alone, a linked flag's share its box and header. */}
      <Box
        className={managed ? undefined : "appbox mb-0"}
        py={managed ? "0" : "3"}
      >
        {editingValues !== null ? (
          <FlagValuesModal
            feature={displayFeature}
            variations={variations}
            initialValues={Object.fromEntries(
              variations.map((v) => [v.id, valueFor(v.id) ?? ""]),
            )}
            initialSparse={sparse}
            sparseEligible={sparseEligible}
            baseDefault={storedDefault ?? ""}
            controlId={managed ? (controlId ?? null) : null}
            configBackingOptionKeys={configBackingOptionKeys}
            close={() => setEditingValues(null)}
            focusVariationId={editingValues}
            apply={({ values: next, sparse: nextSparse }) => {
              stage({ values: next, sparse: nextSparse });
              setEditingValues(null);
            }}
          />
        ) : null}
        {editEnvironments ? (
          <EditExperimentEnvironmentsModal
            info={info}
            stagedScope={stagedScope}
            environmentStates={environmentStates}
            environmentInputs={storedInputs}
            showFlag={false}
            close={() => setEditEnvironments(false)}
            apply={(scope) => {
              flagEnvironments?.set(feature.id, scope);
              setEditEnvironments(false);
            }}
          />
        ) : null}
        {managed ? null : (
          <Flex
            align="center"
            gap="3"
            px="3"
            pb="3"
            mb="3"
            wrap="wrap"
            style={{ borderBottom: "1px solid var(--gray-a5)" }}
          >
            <Flex align="center" gap="2" minWidth="0">
              <PiFlag style={{ color: "var(--color-text-low)" }} />
              <Link href={`/features/${feature.id}`} external weight="medium">
                {feature.id}
              </Link>
            </Flex>
            {problem ? (
              <Flex align="center" gap="1" style={{ color: "var(--amber-11)" }}>
                <PiWarningFill />
                <Text size="sm" weight="medium">
                  {problem}
                </Text>
              </Flex>
            ) : shownDraft &&
              ["pending-review", "changes-requested", "approved"].includes(
                shownDraft.status,
              ) ? (
              <ReviewFeedbackPopover
                featureId={feature.id}
                version={shownDraft.version}
              >
                {badgeLink(shownDraft)}
              </ReviewFeedbackPopover>
            ) : showLive ? null : (
              // The Live view has no revision selected, so nothing to badge.
              // Live only when live holds the rule; otherwise the draft that
              // links it is the state that matters.
              badgeLink(
                shownDraft ??
                  (!info.liveHasMatchingRule && pendingDraft
                    ? pendingDraft
                    : { version: feature.version, status: "published" }),
              )
            )}
            <Flex align="center" gap="3" ml="auto">
              {orphaned || removing || absentFromLive ? null : (
                <>
                  <Flex align="center" gap="1">
                    {environmentStates.length ? (
                      <EnvironmentInputsPopover
                        environmentStates={environmentStates}
                        environmentInputs={environmentInputs}
                        note={environmentsTiming}
                      />
                    ) : null}
                    {canEditFlag && environmentStates.length ? (
                      <Tooltip content="Edit environments">
                        <IconButton
                          variant="ghost"
                          color="violet"
                          radius="medium"
                          size="1"
                          onClick={() => setEditEnvironments(true)}
                          aria-label="Edit environments"
                        >
                          <PiPencilSimple size="14" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Flex>
                  {targetLabel || canChooseTarget ? (
                    <>
                      <Box
                        style={{
                          width: 1,
                          alignSelf: "stretch",
                          background: "var(--gray-a5)",
                        }}
                      />
                      <Box mr="2">{targetControl}</Box>
                    </>
                  ) : null}
                </>
              )}
              {/* A flag with no rule left offers its own remove below. */}
              {canEditFlagLinks &&
              !linkAction &&
              !pendingRemoval &&
              !orphaned ? (
                <DropdownMenu
                  trigger={
                    <IconButton
                      variant="ghost"
                      color="gray"
                      radius="full"
                      size="1"
                      highContrast
                      aria-label={`${feature.id} actions`}
                    >
                      <BsThreeDotsVertical size={14} />
                    </IconButton>
                  }
                  menuPlacement="end"
                  variant="soft"
                >
                  <DropdownMenuItem
                    color="red"
                    disabled={removeBlocked}
                    onClick={() => stageLinkAction("remove")}
                  >
                    <Tooltip
                      content="Set the experiment's status back to Draft to remove this Feature Flag."
                      side="left"
                      enabled={removeBlocked}
                    >
                      <span>Remove from experiment</span>
                    </Tooltip>
                  </DropdownMenuItem>
                </DropdownMenu>
              ) : null}
            </Flex>
          </Flex>
        )}
        {notices.length ? (
          <Flex direction="column" gap="1" mb="3" px={managed ? "0" : "3"}>
            {notices.map((n, i) => (
              <Flex key={i} align="baseline" gap="2" wrap="wrap">
                <HelperText status={n.status} size="sm">
                  {n.text}
                </HelperText>
                {n.action ? <Text size="sm">{n.action}</Text> : null}
              </Flex>
            ))}
          </Flex>
        ) : null}
        {linkAction ? (
          <Flex align="center" justify="between" gap="2" px="3" mb="3">
            <HelperText status="info" size="sm">
              {linkActionNote}
            </HelperText>
            <Button variant="outline" size="sm" onClick={clearLinkAction}>
              Undo
            </Button>
          </Flex>
        ) : pendingRemoval ? (
          <Flex align="center" justify="between" gap="2" px="3" mb="3">
            <Flex align="baseline" gap="2" wrap="wrap">
              <HelperText status="warning" size="sm">
                {`Revision ${pendingRemoval.version} takes this experiment's rule out of the Feature Flag. Once it's published, the Feature Flag leaves this experiment.`}
              </HelperText>
              <Text size="sm">
                {draftLink("Review draft", reviewHref(pendingRemoval.version))}
              </Text>
            </Flex>
            {canEditFlagLinks ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => stageLinkAction("keep")}
              >
                Keep in experiment
              </Button>
            ) : null}
          </Flex>
        ) : orphaned && canEditFlagLinks ? (
          <Flex justify="end" gap="2" px="3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => stageLinkAction("relink")}
            >
              Re-link Feature Flag
            </Button>
            <Button
              variant="outline"
              size="sm"
              color="red"
              onClick={() => stageLinkAction("remove")}
            >
              Remove from experiment
            </Button>
          </Flex>
        ) : null}
        {absentFromLive && !orphaned ? (
          <Box px="3" pb="3">
            <HelperText status="info" size="sm">
              {absentFromLiveNote}
            </HelperText>
          </Box>
        ) : null}
        {/* Top-aligned, so a tall JSON value doesn't push its neighbours down. */}
        {(orphaned && !relinking) || removing || absentFromLive ? null : (
          <Grid columns={VARIATION_GRID_COLUMNS} gap="4" align="start">
            {variations.map((v) => {
              const value = shownValueFor(v.id);
              const duplicate = duplicateIds.has(v.id);
              // Managed values fill their card, framed like a field even when
              // read-only; linked read-only scalars stay bare text.
              const framed = isJson || managed;
              return (
                <Flex
                  key={v.id}
                  // Bare read-only text is one line, so the number centres on it.
                  align={editable || framed ? "start" : "center"}
                  gap="2"
                  px={managed ? "0" : "3"}
                  minWidth="0"
                >
                  {managed ? null : (
                    // On a one-line field's centre line.
                    <Box flexShrink="0" mt={editable || framed ? "2" : "0"}>
                      <VariationNumber number={v.index} />
                    </Box>
                  )}
                  <Box
                    flexGrow="1"
                    minWidth="0"
                    position="relative"
                    className={clsx(styles.valueCell, managed && styles.inset)}
                  >
                    {managed ? (
                      <>
                        <Box
                          className={clsx(
                            styles.insetNumber,
                            isJson || shownType === "string" || !editable
                              ? styles.insetNumberLine
                              : styles.insetNumberFill,
                          )}
                        >
                          <VariationNumber number={v.index} />
                        </Box>
                        <Box className={styles.insetDivider} />
                      </>
                    ) : null}
                    {editable && !isJson ? (
                      <FeatureValueField
                        id={`flag-${feature.id}-${v.id}`}
                        value={value ?? ""}
                        setValue={(next) => stage({ values: { [v.id]: next } })}
                        valueType={shownType}
                        feature={displayFeature}
                        useDropdown
                        inlineConstantButton={!managed}
                        inlineConstantButtonSize="1"
                        actionsOverlay={
                          managed ? MANAGED_STRING_ACTIONS : STRING_ACTIONS
                        }
                        outlineStyle={duplicate ? "error" : undefined}
                        fullWidth
                      />
                    ) : (
                      <Box
                        className={
                          framed
                            ? clsx(
                                styles.valueFrame,
                                cornerStyles.hoverActions,
                                (value === undefined || !isJson) &&
                                  styles.oneLine,
                                duplicate && styles.outlineError,
                              )
                            : undefined
                        }
                      >
                        {value === undefined ? (
                          <HelperText status="warning">No value set</HelperText>
                        ) : (
                          <ForceSummary
                            label={null}
                            value={value}
                            feature={displayFeature}
                            // Control is the base itself, never a patch.
                            sparse={
                              shownSparse && !(managed && v.id === controlId)
                            }
                            fontSize="0.7rem"
                            lineHeight={1.3}
                            actionsOverlay={
                              isJson ? JSON_ACTIONS : ONE_LINE_ACTIONS
                            }
                          />
                        )}
                        {editable && isJson ? (
                          <Tooltip content="Edit values">
                            <IconButton
                              className={clsx(
                                styles.editValue,
                                cornerStyles.actions,
                              )}
                              variant="ghost"
                              color="violet"
                              radius="medium"
                              size="1"
                              onClick={() => setEditingValues(v.id)}
                              aria-label={`Edit ${variationLabel(v)} value`}
                            >
                              <PiPencilSimple size="16" />
                            </IconButton>
                          </Tooltip>
                        ) : null}
                      </Box>
                    )}
                  </Box>
                </Flex>
              );
            })}
          </Grid>
        )}
      </Box>
    </>
  );
}
