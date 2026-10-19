import clsx from "clsx";
import {
  forwardRef,
  HTMLAttributes,
  ReactElement,
  ReactNode,
  useMemo,
  useState,
} from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { FeatureValueType } from "shared/types/feature";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import {
  getConfigSubtree,
  getFeatureBaseConfigKey,
  parsePlainJSONObject,
} from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiArrowSquareOut,
  PiCaretDownFill,
  PiFlag,
  PiPlus,
  PiWarningFill,
} from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  EnvironmentInputsPopover,
  environmentStateTense,
  getEnvironmentStates,
  stageEnvironmentInputs,
  statesFromInputs,
} from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import EditExperimentEnvironmentsModal from "@/components/Experiment/EditExperimentEnvironmentsModal";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Reviews/RevisionLabel";
import {
  draftStatusDotColor,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";
import StatusDot from "@/components/Experiment/StatusDot";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import SegmentedControl from "@/ui/SegmentedControl";
import VariationLabel from "@/ui/VariationLabel";
import FeatureValueCell from "@/components/Features/FeatureValueCell";
import { getDefaultVariationValue } from "@/services/features";
import {
  decimalToPercent,
  rebalance,
  VARIATION_WEIGHT_DECIMALS,
} from "@/services/utils";
import { PercentField } from "@/components/Forms/PercentSliderField";
import { draftApprovalSatisfied } from "@/components/Reviews/reviewAndPublishState";
import { CardHeaderDivider } from "./ImplementationCard";
import {
  FlagEnvironmentsDraft,
  useRegisterExperimentEdit,
  useStagedState,
} from "./ExperimentEdits";
import {
  canStartSeparateDraft,
  FlagDraftPicks,
  resolveDraftPick,
} from "./draftPicks";
import FlagValuesModal from "./FlagValuesModal";
import {
  getDuplicateVariationIds,
  repairVariationValues,
  variationLabel,
} from "./variationValues";
import styles from "./VariationValuesTable.module.scss";

export type FlagView = "draft" | "live";

/** The targeting and traffic cards' width, which a table never goes under. */
export const FUNNEL_WIDTH = 692;
// Two flags fit beside the details panel at its default width on the widest
// page, with room to spare: 1340 page - 360 panel - 48 page padding - 32
// funnel padding = 900.
const VARIATION_MIN_WIDTH = 180;
// The percent field's own minimum, with half a gutter either side.
const SPLIT_WIDTH = 124;
const FLAG_WIDTH = 280;
// The card's own border sits outside the grid.
const BORDERS = 2;

const VALUE_TYPE_LABELS: Record<FeatureValueType, string> = {
  boolean: "Boolean",
  number: "Number",
  string: "String",
  json: "JSON",
};

// A slim, underlined menu trigger: the current choice, cut short where there's
// no room, and a caret. A menu or tooltip hands its trigger handlers and a ref,
// so they land on the span.
const CaretTrigger = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement>
>(function CaretTrigger({ children, ...props }, ref) {
  return (
    <span ref={ref} {...props} className={styles.caretTriggerRoot}>
      <Link underline="none" className={styles.caretTrigger}>
        <Flex align="center" gap="1" minWidth="0">
          <Text size="sm" truncate>
            {children}
          </Text>
          <PiCaretDownFill size={10} style={{ flexShrink: 0 }} />
        </Flex>
      </Link>
    </span>
  );
});

type Staged = {
  values: Record<string, string>;
  sparse?: boolean;
};

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  /** Whether the linked Feature Flags' values can be edited in place. */
  canEditFlagValues: boolean;
  /** Environment scopes staged per flag. */
  flagEnvironments?: FlagEnvironmentsDraft;
  draftPicks: FlagDraftPicks;
  /** Whether the flags show what they serve, or what their drafts propose. */
  flagView: FlagView;
  /** Switches the view; absent where only drafts matter. */
  onChangeFlagView?: ((view: FlagView) => void) | null;
  /** Each variation's share of the traffic, as decimals in variation order. */
  split: number[];
  /** Stages a new split; absent where it can't be edited here. */
  onChangeSplit?: ((split: number[]) => void) | null;
  /** Shown under the split, such as who sets it. */
  splitNote?: string | null;
  onEditKeys?: () => void;
  onRemoveVariation?: (variationIndex: number) => void;
  onReorder?: () => void;
  onAddVariation?: () => void;
}

/**
 * One row per variation: its share of the traffic, then a column per linked
 * Feature Flag holding the value it serves. Each flag's state sits under its values, so the
 * values read straight down from the flag.
 */
export default function VariationValuesTable({
  experiment,
  linkedFeatures,
  canEditFlagValues,
  flagEnvironments,
  draftPicks,
  flagView,
  onChangeFlagView = null,
  split,
  onChangeSplit = null,
  splitNote = null,
  onEditKeys,
  onRemoveVariation,
  onReorder,
  onAddVariation,
}: Props) {
  const variations = getLatestPhaseVariations(experiment);
  const hasMenu = !!(onEditKeys || onRemoveVariation || onReorder);
  // Fixed columns; the variations take what's left of the cards' width.
  const columns = [
    `minmax(${VARIATION_MIN_WIDTH}px, 1fr)`,
    `${SPLIT_WIDTH}px`,
    ...linkedFeatures.map(() => `${FLAG_WIDTH}px`),
  ].join(" ");
  const tableWidth = Math.max(
    FUNNEL_WIDTH - BORDERS,
    VARIATION_MIN_WIDTH + SPLIT_WIDTH + linkedFeatures.length * FLAG_WIDTH,
  );
  // Rows: the header, one per variation, then each column's state beside
  // adding a variation (empty cells take no room).
  const firstValueRow = 2;
  const detailsRow = firstValueRow + variations.length;
  const firstFlagColumn = 3;

  if (!variations.length) return null;

  return (
    <Box
      mx="auto"
      // As wide as its columns, up to all the room there is; then it scrolls.
      style={{ width: "fit-content", maxWidth: "100%" }}
    >
      {onChangeFlagView ? (
        <Flex justify="end" mb="2">
          <SegmentedControl
            aria-label="Show Feature Flag values from"
            size="sm"
            value={flagView}
            setValue={onChangeFlagView}
            options={[
              { value: "draft", label: "Draft" },
              { value: "live", label: "Live" },
            ]}
          />
        </Flex>
      ) : null}
      <Box className="appbox mb-0" style={{ overflow: "hidden" }}>
        <Box style={{ overflowX: "auto" }}>
          <div
            className={styles.grid}
            style={{ gridTemplateColumns: columns, width: tableWidth }}
          >
            <div
              className={clsx(styles.headerCell, styles.pinnedStart)}
              style={{ gridRow: 1, gridColumn: 1 }}
            >
              <Heading as="h4" size="sm" color="text-high" mb="0">
                Variations
              </Heading>
              {hasMenu ? (
                <Flex ml="auto">
                  <DropdownMenu
                    trigger={
                      <IconButton
                        variant="ghost"
                        color="gray"
                        radius="full"
                        size="1"
                        highContrast
                        className={styles.revealOnHover}
                        aria-label="Variation actions"
                      >
                        <BsThreeDotsVertical size={14} />
                      </IconButton>
                    }
                    menuPlacement="start"
                    variant="soft"
                  >
                    {onReorder ? (
                      <DropdownMenuItem onClick={onReorder}>
                        Reorder variations
                      </DropdownMenuItem>
                    ) : null}
                    {onEditKeys ? (
                      <DropdownMenuItem onClick={onEditKeys}>
                        Change variation IDs
                      </DropdownMenuItem>
                    ) : null}
                    {onRemoveVariation ? (
                      <DropdownSubMenu trigger="Remove variation">
                        {variations.map((v, i) => (
                          <DropdownMenuItem
                            key={v.id}
                            color="red"
                            onClick={() => onRemoveVariation(i)}
                          >
                            <VariationLabel number={v.index} name={v.name} />
                          </DropdownMenuItem>
                        ))}
                      </DropdownSubMenu>
                    ) : null}
                  </DropdownMenu>
                </Flex>
              ) : null}
            </div>
            {variations.map((v, i) => (
              <div
                key={v.id}
                className={clsx(styles.cell, styles.pinnedStart)}
                style={{ gridRow: firstValueRow + i, gridColumn: 1 }}
              >
                <div className={styles.fieldLine}>
                  <VariationLabel number={v.index} name={v.name} />
                </div>
              </div>
            ))}
            {/* Under the variations, beside each column's state. */}
            <div
              className={clsx(styles.detailsCell, styles.pinnedStart)}
              style={{ gridRow: detailsRow, gridColumn: 1 }}
            >
              {onAddVariation ? (
                <Flex>
                  <Link onClick={onAddVariation}>
                    <Flex align="center" gap="1">
                      <PiPlus />
                      Add variation
                    </Flex>
                  </Link>
                </Flex>
              ) : null}
            </div>

            <SplitColumn
              column={2}
              last={!linkedFeatures.length}
              firstValueRow={firstValueRow}
              detailsRow={detailsRow}
              variations={variations}
              split={split}
              onChange={onChangeSplit}
              note={splitNote}
            />

            {linkedFeatures.map((info, i) => (
              <FlagColumn
                key={info.feature.id}
                column={firstFlagColumn + i}
                last={i === linkedFeatures.length - 1}
                firstValueRow={firstValueRow}
                detailsRow={detailsRow}
                experiment={experiment}
                info={info}
                canEdit={canEditFlagValues}
                flagEnvironments={flagEnvironments}
                draftPicks={draftPicks}
                showingLive={flagView === "live"}
              />
            ))}
          </div>
        </Box>
      </Box>
    </Box>
  );
}

/** Each variation's share of the traffic, rebalanced as one changes. */
function SplitColumn({
  column,
  last,
  firstValueRow,
  detailsRow,
  variations,
  split,
  onChange,
  note,
}: {
  column: number;
  // The table's right edge, which gets the same inset as its left.
  last: boolean;
  firstValueRow: number;
  detailsRow: number;
  variations: ReturnType<typeof getLatestPhaseVariations>;
  split: number[];
  onChange: ((split: number[]) => void) | null;
  note: string | null;
}) {
  const equal = split.every((w) => Math.abs(w - split[0]) < 0.0001);
  return (
    <>
      <div
        className={clsx(styles.headerCell, last && styles.lastColumn)}
        style={{ gridRow: 1, gridColumn: column }}
      >
        <Text weight="medium">Split</Text>
      </div>
      {variations.map((v, i) => (
        <div
          key={v.id}
          className={clsx(styles.cell, last && styles.lastColumn)}
          style={{ gridRow: firstValueRow + i, gridColumn: column }}
        >
          <div className={clsx(styles.fieldLine, styles.splitField)}>
            {onChange ? (
              <PercentField
                value={split[i] ?? 0}
                // Otherwise the rest of the split rebalances mid-keystroke.
                commitOn="blur"
                step="any"
                decimals={VARIATION_WEIGHT_DECIMALS}
                onChange={(weight) => onChange(rebalance(split, i, weight))}
                ariaLabel={`${variationLabel(v)} split`}
              />
            ) : (
              <Text>{decimalToPercent(split[i] ?? 0)}%</Text>
            )}
          </div>
        </div>
      ))}
      <div
        className={clsx(styles.detailsCell, last && styles.lastColumn)}
        style={{ gridRow: detailsRow, gridColumn: column }}
      >
        {note ? (
          <Text size="sm" color="text-low">
            {note}
          </Text>
        ) : onChange && !equal ? (
          <Link
            size="sm"
            onClick={() => onChange(getEqualWeights(variations.length))}
          >
            Set equal
          </Link>
        ) : null}
      </div>
    </>
  );
}

function FlagColumn({
  column,
  last,
  firstValueRow,
  detailsRow,
  experiment,
  info,
  canEdit,
  flagEnvironments,
  draftPicks,
  showingLive,
}: {
  column: number;
  last: boolean;
  firstValueRow: number;
  detailsRow: number;
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  canEdit: boolean;
  flagEnvironments?: FlagEnvironmentsDraft;
  draftPicks: FlagDraftPicks;
  // What the flag serves, read-only. Edits stay staged for the draft.
  showingLive: boolean;
}) {
  const permissionsUtil = usePermissionsUtil();
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
  } = useMemo(() => resolveDraftPick(info, pick), [info, pick]);

  // Where Save writes, and what the row shows.
  const fromDraft = !!pendingDraft && target === "draft";
  // What's on screen; Live changes only this, never where edits go.
  const showsDraft = fromDraft && !showingLive;
  const workingOn = fromDraft ? pendingDraft.version : "new";
  // Its rule is gone, so nothing edits here until it's linked again.
  const orphaned = info.state === "discarded";
  // Staged for the page's Save: link the flag again, or take it off.
  const [linkAction, setLinkAction] = useStagedState<
    "relink" | "remove" | "keep" | null
  >(`link:${feature.id}`, null);
  const relinking = linkAction === "relink";
  const removing = linkAction === "remove";
  // A draft is taking the live rule out; the flag leaves when it publishes.
  const pendingRemoval = info.pendingRemoval;
  const liveValues = info.liveValues ?? info.values;
  const liveSparse = info.liveSparse ?? info.sparse ?? false;
  // Linking again starts from the rule the discarded draft left, when it can.
  const values = relinking
    ? (info.relinkFrom?.values ??
      variations.map((v, i) => ({
        variationId: v.id,
        value: i
          ? getDefaultVariationValue(feature.defaultValue)
          : feature.defaultValue,
      })))
    : fromDraft
      ? pendingDraft.values
      : liveValues;
  const storedSparse = relinking
    ? !!info.relinkFrom?.sparse
    : fromDraft
      ? pendingDraft.sparse
      : liveSparse;
  const valueType = feature.valueType;
  const sparseBase = fromDraft
    ? pendingDraft.defaultValue
    : feature.defaultValue;

  // Edits belong to the draft they were made in; if it goes, so do they.
  const [stagedFor, setStaged] = useStagedState<
    (Staged & { for: number | "new" }) | null
  >(`flag:${feature.id}`, null);
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
  const sparse = staged?.sparse ?? storedSparse;

  const configKey = getFeatureBaseConfigKey(feature);
  const configBackingOptionKeys = useMemo(
    () => (configKey ? getConfigSubtree(configKey, configs) : undefined),
    [configKey, configs],
  );
  const sparseEligible =
    !configKey &&
    valueType === "json" &&
    parsePlainJSONObject(sparseBase) !== null;

  // Against the type and default the values will land under.
  const displayFeature = useMemo(
    () => ({ ...feature, valueType, defaultValue: sparseBase }),
    [feature, valueType, sparseBase],
  );
  const lockedBySchedule = fromDraft && pendingDraft.lockedBySchedule;
  const onFlag = info.state === "live" || info.state === "draft";
  const editable =
    canEdit &&
    !pendingRemoval &&
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
        sparse: patch.sparse ?? kept?.sparse,
      };
    });
  };

  // Two variations serving the same thing is almost always a mistake.
  const duplicateIds = getDuplicateVariationIds(
    variations.map((v) => ({ variationId: v.id, value: valueFor(v.id) })),
    valueType,
    sparse,
    sparseBase,
  );

  const dirty =
    !!stagedScope ||
    (!!staged &&
      (sparse !== storedSparse ||
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
    changes: (options) => ({
      flagValues: [
        {
          featureId: feature.id,
          variations: checkedValues(options),
          ...(sparse !== storedSparse && { sparse }),
          ...(stagedScope && { environments: stagedScope }),
          // Writes into the draft the values came from; off live, starts one.
          revision: fromDraft
            ? {
                version: pendingDraft.version,
                dateUpdated: pendingDraft.dateUpdated,
              }
            : { version: feature.version, dateUpdated: null },
        },
      ],
    }),
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
  const canStartNew = canStartSeparateDraft(info) && canEdit;
  // Several drafts change this rule: pick which one the column shows and
  // saves to.
  const canChooseTarget = !!pendingDraft && (drafts.length > 1 || canStartNew);
  const canEditFlag =
    canEdit && !pendingRemoval && permissionsUtil.canEditFeatureDrafts(feature);
  const canEditFlagLinks =
    canEdit && permissionsUtil.canEditFeatureDrafts(feature);
  const launches = experiment.status === "draft";
  // A running experiment keeps its flags until it's back in Draft.
  const removeBlocked = experiment.status === "running";
  const launchDraft = drafts[0];
  const draftLaunches = launches && isLaunchDraft;
  const stageLinkAction = (action: "relink" | "remove" | "keep") => {
    clearStaged();
    setLinkAction(action);
  };

  // Flagged by the column's title, so it's seen without reading its notices.
  const shownDraft = showsDraft ? pendingDraft : null;
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
  const cannotPublishLaunch =
    !!shownDraft && draftLaunches && !!info.cannotPublish;
  const reviewHref = (version: number) =>
    `/features/${feature.id}?v=${version}#review`;
  const draftHref = shownDraft
    ? reviewHref(shownDraft.version)
    : `/features/${feature.id}`;
  // A new tab, so following it never costs the page's unsaved edits.
  // Underlined in running text; a popover's links underline on hover.
  const draftLink = (
    label: string,
    href = draftHref,
    underline: "always" | "hover" = "always",
  ) => (
    <Link href={href} external underline={underline}>
      {label}
      <PiArrowSquareOut style={{ marginLeft: "var(--space-1)" }} />
    </Link>
  );

  const notices: {
    status: "error" | "warning" | "info";
    text: ReactNode;
    action?: ReactNode;
  }[] = [];
  // What's next for the draft shown, told by its status dot.
  const draftNotes: string[] = [];
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
  const orphanText = "This Feature Flag has no rule for this experiment.";
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
  } else if (shownDraft && !lockedBySchedule && !cannotPublishLaunch) {
    draftNotes.push(
      launches && !isLaunchDraft && launchDraft
        ? `Only Revision ${launchDraft.version} publishes when the experiment starts. Publish ${draftMention} from the Feature Flag.`
        : needsApproval
          ? launches
            ? `${draftMention} needs approval. Once approved, it publishes when the experiment starts.`
            : `${draftMention} needs approval before it can publish.`
          : launches
            ? `${draftMention} publishes when the experiment starts, or publish it from the Feature Flag.`
            : experiment.status === "running"
              ? `Publish ${draftMention} from the Feature Flag to change what this experiment serves.`
              : `Publish ${draftMention} from the Feature Flag.`,
    );
  }
  if (cannotPublishLaunch) {
    notices.push({
      status: "error",
      text:
        experiment.nextScheduledStatusUpdate?.type === "start"
          ? "Whoever scheduled this start can no longer publish this Feature Flag draft. Unschedule or reschedule the start, then approve it again from an account that can."
          : "You don't have permission to publish this Feature Flag draft, so it can't be published when the experiment starts.",
      action: draftLink("Review draft"),
    });
  }
  if (lockedBySchedule) {
    draftNotes.push("Locked until its scheduled publish.");
  }
  // These describe the revision the server read: the newest draft, or live.
  const describesShown = showsDraft
    ? info.state === "draft" && pendingDraft.version === drafts[0]?.version
    : info.state === "live";
  if (onFlag && describesShown && info.inconsistentValues) {
    notices.push({
      status: "warning",
      text: `This experiment is on the Feature Flag more than once with different values. Showing the first, from ${info.valuesFrom}.`,
    });
  }
  // Says why values are outlined, which a tall value can hide.
  if (!showingLive && duplicateIds.size) {
    const repeated = new Intl.ListFormat("en", { type: "conjunction" }).format(
      variations.filter((v) => duplicateIds.has(v.id)).map(variationLabel),
    );
    notices.push({
      status: "error",
      text:
        duplicateIds.size === 2
          ? `${repeated} serve the same value.`
          : `${repeated} serve duplicate values.`,
    });
  }
  if (onFlag && describesShown && info.rulesAbove) {
    notices.push({
      status: "info",
      text: "Flag has rules above experiment's rule.",
    });
  }

  const storedInputs = fromDraft
    ? pendingDraft.environmentInputs
    : (info.liveEnvironmentInputs ?? info.environmentInputs);
  const shownScope = showingLive ? null : stagedScope;
  const shownInputs = showsDraft
    ? pendingDraft.environmentInputs
    : (info.liveEnvironmentInputs ?? info.environmentInputs);
  const environmentInputs =
    shownInputs && stageEnvironmentInputs(shownInputs, shownScope);
  const environmentStates = getEnvironmentStates(
    shownScope && environmentInputs
      ? { environmentStates: statesFromInputs(environmentInputs) }
      : showsDraft
        ? pendingDraft
        : {
            environmentStates:
              info.liveEnvironmentStates ?? info.environmentStates,
          },
    {
      future: environmentStateTense({
        status: experiment.status,
        unpublished: showsDraft || !!shownScope,
        launches: isLaunchDraft,
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
    if ((!showsDraft && !shownScope) || !input) {
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
    : `${showsDraft ? `From ${draftMention}. ` : ""}${
        draftLaunches
          ? "Takes effect when it's published, or when the experiment starts."
          : "Takes effect when it's published."
      }`;

  const linkActionNote =
    linkAction === "keep"
      ? `Saving puts the rule back into Revision ${pendingRemoval?.version}.`
      : relinking
        ? experiment.status === "running"
          ? "Saving adds the rule to a new draft. Publish it to serve the experiment."
          : launches
            ? "Saving adds the rule to a new draft, published when the experiment starts."
            : "Saving adds the rule to a new draft."
        : info.liveHasMatchingRule
          ? "Saving starts a draft that removes the rule. Publish it to unlink the flag."
          : "Saving unlinks the flag.";

  // Nothing to show while there's no rule to hold the values.
  // Live has no rule for it yet: it serves nothing here.
  const notLive = showingLive && !info.liveHasMatchingRule;
  // No rule to hold values: the column says why instead, and how to resolve it.
  const noValues = (orphaned && !relinking) || notLive;
  const details = [
    ...notices,
    ...(pendingRemoval && !linkAction
      ? [
          {
            status: "warning" as const,
            text: `Revision ${pendingRemoval.version} takes this experiment's rule out of the Feature Flag. Once it's published, the Feature Flag leaves this experiment.`,
            action: draftLink(
              "Review draft",
              reviewHref(pendingRemoval.version),
            ),
          },
        ]
      : []),
  ];
  const showEnvironments =
    environmentStates.length > 0 && !orphaned && !removing;
  const canEditEnvironments = canEditFlag && showEnvironments;
  // The revision the values come from: live in the Live view; otherwise the
  // draft Save writes to, or the one it starts.
  const startsDraft =
    !showsDraft && !showingLive && (editable || canChooseTarget);
  const revisionName = showsDraft
    ? revisionLabelText(
        pendingDraft.version,
        pendingDraft.title,
        !!pendingDraft.title,
      )
    : startsDraft
      ? "New draft"
      : notLive
        ? "Not live"
        : "Live";
  // What the revision is, by the feature list's colors, and what's next for
  // it on hover.
  const revisionStatus = showsDraft
    ? pendingDraft.status
    : startsDraft
      ? "draft"
      : "live";
  const revisionNotes = showsDraft
    ? draftNotes
    : startsDraft
      ? ["Saving starts a new draft of this Feature Flag."]
      : notLive
        ? [
            "This experiment isn't in the live revision of this Feature Flag yet.",
          ]
        : ["What this Feature Flag serves now."];
  // A draft going through approval is approved and published on its review.
  const inReview =
    !!shownDraft &&
    (needsApproval ||
      ["pending-review", "approved", "changes-requested"].includes(
        shownDraft.status,
      ));
  const revisionDot = (
    <StatusDot
      color={
        notLive
          ? "var(--gray-8)"
          : revisionStatus === "live"
            ? "var(--green-9)"
            : draftStatusDotColor(revisionStatus)
      }
    />
  );
  const revisionPicker =
    canChooseTarget && !showingLive ? (
      <DropdownMenu
        trigger={<CaretTrigger>{revisionName}</CaretTrigger>}
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
    ) : null;
  // Opens on hover like the environments beside it, with the way to review.
  const revisionDetails = (trigger: ReactElement) => (
    <Popover
      openOnHover
      side="bottom"
      align="end"
      avoidCollisions={false}
      trigger={trigger}
      content={
        <Flex direction="column" gap="2" style={{ maxWidth: 280 }}>
          <Flex align="center" gap="2">
            {revisionDot}
            <Text size="sm" weight="medium">
              {showsDraft ? revisionStatusLabel(revisionStatus) : revisionName}
            </Text>
          </Flex>
          {/* A titled draft's full name; the notes name an untitled one. */}
          {showsDraft && pendingDraft.title ? (
            <Text size="sm" color="text-low">
              {revisionName}
            </Text>
          ) : null}
          {revisionNotes.map((note) => (
            <Text key={note} size="sm">
              {note}
            </Text>
          ))}
          {inReview ? (
            <Text size="sm">
              {draftLink("Review & Publish", draftHref, "hover")}
            </Text>
          ) : null}
        </Flex>
      }
    />
  );
  // A menu's trigger can't also open a popover, so a picker's is on its dot.
  const revisionControl = revisionPicker ? (
    <Flex align="center" gap="2" minWidth="0">
      {revisionDetails(<Flex align="center">{revisionDot}</Flex>)}
      {revisionPicker}
    </Flex>
  ) : (
    revisionDetails(
      <Flex align="center" gap="2" minWidth="0" style={{ cursor: "default" }}>
        {revisionDot}
        <Text size="sm" color="text-low" truncate>
          {revisionName}
        </Text>
      </Flex>,
    )
  );

  const reviewItem =
    shownDraft && !inReview ? (
      // A new tab, so following it never costs the page's unsaved edits.
      <DropdownMenuItem
        key="review"
        onClick={() => {
          window.open(draftHref, "_blank", "noopener,noreferrer");
        }}
      >
        <Flex align="center" gap="1">
          Review draft
          <PiArrowSquareOut />
        </Flex>
      </DropdownMenuItem>
    ) : null;
  const editItems = [
    canEditEnvironments ? (
      <DropdownMenuItem key="env" onClick={() => setEditEnvironments(true)}>
        Edit environments
      </DropdownMenuItem>
    ) : null,
    // One without a rule offers its choices in the column itself.
    canEditFlagLinks && !linkAction && !pendingRemoval && !orphaned ? (
      <DropdownMenuItem
        key="remove"
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
    ) : null,
  ].filter(Boolean);
  // Live is read-only: its changes are made in the draft.
  // Staged for Save, with the way to take it back.
  const stagedLinkAction = (
    <Flex direction="column" gap="2">
      <HelperText status="info" size="sm">
        {linkActionNote}
      </HelperText>
      <Flex justify="end">
        <Button variant="outline" size="sm" onClick={clearLinkAction}>
          Undo
        </Button>
      </Flex>
    </Flex>
  );
  // No rule anywhere: link it again, or let it go. Live only shows what
  // serves, so its choices are made in the draft view.
  const orphanNote = (
    <Flex direction="column" gap="2">
      <HelperText status="warning" size="sm">
        {orphanText}
      </HelperText>
      {canEditFlagLinks && !showingLive ? (
        <Flex justify="end" gap="3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => stageLinkAction("relink")}
          >
            Re-link
          </Button>
          <Button
            variant="outline"
            size="sm"
            color="red"
            onClick={() => stageLinkAction("remove")}
          >
            Remove
          </Button>
        </Flex>
      ) : null}
    </Flex>
  );
  const menuItems = showingLive
    ? []
    : [
        reviewItem,
        reviewItem && editItems.length ? (
          <DropdownMenuSeparator key="separator" />
        ) : null,
        ...editItems,
      ].filter(Boolean);

  return (
    <>
      {editingValues !== null ? (
        <FlagValuesModal
          feature={displayFeature}
          variations={variations}
          initialValues={Object.fromEntries(
            variations.map((v) => [v.id, valueFor(v.id) ?? ""]),
          )}
          initialSparse={sparse}
          sparseEligible={sparseEligible}
          baseDefault={sparseBase}
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

      <div
        className={clsx(styles.headerCell, last && styles.lastColumn)}
        style={{ gridRow: 1, gridColumn: column }}
      >
        <Flex align="center" gap="2" width="100%" minWidth="0">
          <PiFlag style={{ color: "var(--color-text-low)", flexShrink: 0 }} />
          <Text weight="medium" truncate>
            {/* A new tab, so following it never costs the page's edits. */}
            <Link href={`/features/${feature.id}`} external>
              {feature.id}
            </Link>
          </Text>
          {problem ? (
            <Tooltip content={problem}>
              <Flex flexShrink="0" style={{ color: "var(--amber-11)" }}>
                <PiWarningFill />
              </Flex>
            </Tooltip>
          ) : null}
          <Box flexGrow="1" />
          <Flex
            align="center"
            gap="2"
            flexShrink="0"
            className={styles.revealOnHover}
          >
            <Text size="sm" color="text-low" whiteSpace="nowrap">
              {VALUE_TYPE_LABELS[valueType]}
            </Text>
            {menuItems.length ? (
              <>
                <CardHeaderDivider />
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
                  {menuItems}
                </DropdownMenu>
              </>
            ) : null}
          </Flex>
        </Flex>
      </div>

      {noValues
        ? // Nothing to show; the column's note below says why.
          variations.map((v, i) => (
            <div
              key={v.id}
              className={clsx(styles.cell, last && styles.lastColumn)}
              style={{ gridRow: firstValueRow + i, gridColumn: column }}
            />
          ))
        : variations.map((v, i) => {
            const value = showingLive
              ? liveValues.find((l) => l.variationId === v.id)?.value
              : valueFor(v.id);
            const duplicate = !showingLive && duplicateIds.has(v.id);
            return (
              <div
                key={v.id}
                className={clsx(styles.cell, last && styles.lastColumn)}
                style={{ gridRow: firstValueRow + i, gridColumn: column }}
              >
                <FeatureValueCell
                  id={`flag-${feature.id}-${v.id}`}
                  value={value}
                  feature={showingLive ? feature : displayFeature}
                  sparse={showingLive ? liveSparse : sparse}
                  editable={editable && !showingLive}
                  error={duplicate}
                  onChange={(next) => stage({ values: { [v.id]: next } })}
                  onOpenEditor={() => setEditingValues(v.id)}
                  label={variationLabel(v)}
                />
              </div>
            );
          })}

      <div
        className={clsx(styles.detailsCell, last && styles.lastColumn)}
        style={{ gridRow: detailsRow, gridColumn: column }}
      >
        {showEnvironments || !noValues ? (
          <Flex align="center" gap="3" width="100%" minWidth="0">
            {showEnvironments ? (
              <EnvironmentInputsPopover
                environmentStates={environmentStates}
                environmentInputs={environmentInputs}
                note={environmentsTiming}
                onEdit={
                  canEditEnvironments && !showingLive
                    ? () => setEditEnvironments(true)
                    : null
                }
              />
            ) : null}
            <Box flexGrow="1" />
            {noValues ? null : revisionControl}
          </Flex>
        ) : null}
        {/* Set apart from the row above; collapses when there's nothing. */}
        <Flex direction="column" gap="1" className={styles.footerMessages}>
          {noValues ? (
            !orphaned ? (
              <Text size="sm" color="text-low">
                Not in the live revision yet.
              </Text>
            ) : linkAction && !showingLive ? (
              stagedLinkAction
            ) : (
              orphanNote
            )
          ) : linkAction && !showingLive ? (
            stagedLinkAction
          ) : null}
          {details.map((n, i) => (
            <Flex key={i} align="baseline" gap="2" wrap="wrap">
              <HelperText status={n.status} size="sm">
                {n.text}
              </HelperText>
              {n.action ? <Text size="sm">{n.action}</Text> : null}
            </Flex>
          ))}
          {pendingRemoval && !linkAction && canEditFlagLinks && !showingLive ? (
            <Flex justify="end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => stageLinkAction("keep")}
              >
                Keep in experiment
              </Button>
            </Flex>
          ) : null}
        </Flex>
      </div>
    </>
  );
}
