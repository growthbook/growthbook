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
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import {
  getConfigSubtree,
  getFeatureBaseConfigKey,
  hasPendingScheduledStart,
  linkedFeatureEnvStates,
  parsePlainJSONObject,
  pendingDraftApproved,
  startBypassCovers,
} from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiArrowSquareOut,
  PiCaretDownFill,
  PiFlag,
  PiPlus,
} from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  EnvironmentInputsPopover,
  getEnvironmentStates,
  stageEnvironmentInputs,
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
import VariationLabel from "@/ui/VariationLabel";
import FeatureValueCell from "@/components/Features/FeatureValueCell";
import { ValueDiffProvider } from "@/components/Features/ValueDiffContext";
import FeatureValueTypeDisplay from "@/components/Features/FeatureValueTypeDisplay";
import { getDefaultVariationValue } from "@/services/features";
import {
  decimalToPercent,
  isEqualSplit,
  rebalance,
  VARIATION_WEIGHT_DECIMALS,
} from "@/services/utils";
import { PercentField } from "@/components/Forms/PercentSliderField";
import {
  ColumnCell,
  ColumnFooter,
  ColumnHeader,
  ColumnLayout,
  HeaderKind,
  HeaderText,
  ImplementationColumn,
  StagedNote,
} from "./ImplementationColumn";
import {
  FlagEnvironmentsDraft,
  useExperimentEdits,
  useEditBase,
  useRegisterExperimentEdit,
  useStagedState,
} from "./ExperimentEdits";
import {
  canStartSeparateDraft,
  draftReviewHref,
  draftReviewState,
  FlagDraftPicks,
  resolveDraftPick,
  revisionHref,
} from "./draftPicks";
import FlagValuesModal from "./FlagValuesModal";
import FunnelConnector from "./FunnelConnector";
import {
  getDuplicateVariationIds,
  repairVariationValues,
  variationLabel,
} from "./variationValues";
import styles from "./VariationValuesTable.module.scss";

const TABLE_MIN_WIDTH = 692;
const VARIATION_NARROWEST_WIDTH = 130;
const SPLIT_WIDTH = 124;
const FLAG_WIDTH = 280;
const MAX_FLAG_WIDTH = 350;
const BORDERS = 2;
const VARIATION_WIDTH = TABLE_MIN_WIDTH - BORDERS - SPLIT_WIDTH - FLAG_WIDTH;

const CaretTrigger = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement>
>(function CaretTrigger({ children, ...props }, ref) {
  return (
    <span ref={ref} {...props} className={styles.caretTriggerRoot}>
      <Link
        underline="none"
        className={styles.caretTrigger}
        style={{ color: "var(--color-text-high)" }}
      >
        <Flex align="center" gap="1" minWidth="0">
          <Text size="sm" truncate>
            {children}
          </Text>
          <PiCaretDownFill style={{ flexShrink: 0 }} />
        </Flex>
      </Link>
    </span>
  );
});

type Staged = {
  values: Record<string, string>;
  sparse?: boolean;
};
type StagedFor = Staged & { for: number | "new" };

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  canEditFlagValues: boolean;
  flagEnvironments: FlagEnvironmentsDraft;
  draftPicks: FlagDraftPicks;
  split: number[];
  onChangeSplit: ((split: number[]) => void) | null;
  splitNote: string | null;
  onEditKeys?: () => void;
  onRemoveVariation?: (variationIndex: number) => void;
  onReorder?: () => void;
  onAddVariation?: () => void;
  implementationColumns: ImplementationColumn[];
  addImplementation: ReactNode;
}

export default function VariationValuesTable({
  experiment,
  linkedFeatures,
  canEditFlagValues,
  flagEnvironments,
  draftPicks,
  split,
  onChangeSplit,
  splitNote,
  onEditKeys,
  onRemoveVariation,
  onReorder,
  onAddVariation,
  implementationColumns,
  addImplementation,
}: Props) {
  const variations = getLatestPhaseVariations(experiment);
  const hasMenu = !!(onEditKeys || onRemoveVariation || onReorder);
  // Per flag rather than per column, so every column of one flag agrees.
  const [linkActions, setLinkActions] = useStagedState<
    Record<string, LinkAction>
  >("link-actions", {});
  const setLinkAction = (featureId: string, action: LinkAction | null) =>
    setLinkActions((prev) => {
      const next = { ...prev };
      if (action) next[featureId] = action;
      else delete next[featureId];
      return next;
    });
  // A flag staged for removal leaves the table; discarding brings it back.
  const removedFlags = linkedFeatures
    .map((info) => info.feature.id)
    .filter(
      (id) => experiment.status === "draft" && linkActions[id] === "remove",
    );
  const flagColumns = linkedFeatures
    .filter((info) => !removedFlags.includes(info.feature.id))
    .flatMap((info): FlagColumnSource[] =>
      info.valueGroups?.length
        ? info.valueGroups.map((group, index) => ({
            key: `${info.feature.id}:${group.ruleIds.join(",")}`,
            info: { ...group, feature: info.feature },
            group: {
              ruleIds: group.ruleIds,
              environments: group.environments,
              first: index === 0,
            },
          }))
        : [{ key: info.feature.id, info, group: null }],
    );
  const columnCount = flagColumns.length + implementationColumns.length;
  const flagTrack = `clamp(${FLAG_WIDTH}px, (100cqw - ${
    BORDERS + VARIATION_WIDTH + SPLIT_WIDTH
  }px) / ${columnCount}, ${MAX_FLAG_WIDTH}px)`;
  const columns = [
    `minmax(${VARIATION_NARROWEST_WIDTH}px, 1fr)`,
    `${SPLIT_WIDTH}px`,
    ...Array(columnCount).fill(flagTrack),
  ].join(" ");
  const tableWidth = Math.max(
    TABLE_MIN_WIDTH - BORDERS,
    VARIATION_WIDTH + SPLIT_WIDTH + columnCount * MAX_FLAG_WIDTH,
  );
  const firstValueRow = 2;
  const detailsRow = firstValueRow + variations.length;
  const firstImplementationColumn = 3;
  const layoutFor = (i: number): ColumnLayout => ({
    column: firstImplementationColumn + i,
    last: i === columnCount - 1,
    firstValueRow,
    detailsRow,
    variations,
  });
  const [scrolled, setScrolled] = useState(false);

  if (!variations.length) return null;

  return (
    <Box
      mx="auto"
      className={styles.sizeContainer}
      style={{ width: tableWidth + BORDERS, maxWidth: "100%" }}
    >
      <Box position="relative">
        <Box
          position="absolute"
          top="0"
          bottom="0"
          left="50%"
          style={{ transform: "translateX(-50%)" }}
        >
          <FunnelConnector fill />
        </Box>
        <Box pt="3" pb="2" minHeight="22px" />
      </Box>
      <Box className="appbox mb-0" style={{ overflow: "hidden" }}>
        <Box
          style={{ overflowX: "auto", overflowY: "hidden" }}
          onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}
        >
          <div
            className={clsx(styles.grid, scrolled && styles.scrolled)}
            style={{
              gridTemplateColumns: columns,
              width: "100%",
              minWidth: "min-content",
            }}
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
                        size="2"
                        highContrast
                        className={styles.revealOnHover}
                        aria-label="Variation actions"
                      >
                        <BsThreeDotsVertical size={16} />
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
            <div
              className={clsx(styles.detailsCell, styles.pinnedStart)}
              style={{ gridRow: detailsRow, gridColumn: 1 }}
            >
              {onAddVariation ? (
                <div className={styles.footerLine}>
                  <Link onClick={onAddVariation}>
                    <Flex
                      align="center"
                      gap="1"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      <PiPlus />
                      <span className={styles.baselineText}>Add variation</span>
                    </Flex>
                  </Link>
                </div>
              ) : null}
            </div>

            <SplitColumn
              layout={{ ...layoutFor(0), column: 2, last: !columnCount }}
              split={split}
              onChange={onChangeSplit}
              note={splitNote}
            />

            {flagColumns.map(({ key, info, group }, i) => (
              <div key={key} className={styles.implementationColumn}>
                <FlagColumn
                  layout={layoutFor(i)}
                  experiment={experiment}
                  info={info}
                  group={group}
                  canEdit={canEditFlagValues}
                  flagEnvironments={flagEnvironments}
                  draftPicks={draftPicks}
                  linkAction={linkActions[info.feature.id] ?? null}
                  setLinkAction={(action) =>
                    setLinkAction(info.feature.id, action)
                  }
                />
              </div>
            ))}
            {implementationColumns.map((c, i) => (
              <div key={c.key} className={styles.implementationColumn}>
                {c.render(layoutFor(flagColumns.length + i))}
              </div>
            ))}
            {removedFlags.map((id) => (
              <StagedUnlink
                key={id}
                featureId={id}
                discard={() => setLinkAction(id, null)}
              />
            ))}
          </div>
        </Box>
      </Box>
      {addImplementation ? (
        <Flex justify="end" mt="4">
          {addImplementation}
        </Flex>
      ) : null}
    </Box>
  );
}

function SplitColumn({
  layout,
  split,
  onChange,
  note,
}: {
  layout: ColumnLayout;
  split: number[];
  onChange: ((split: number[]) => void) | null;
  note: string | null;
}) {
  const { variations } = layout;
  const equal = isEqualSplit(split);
  const edits = useExperimentEdits();
  return (
    <>
      <div
        className={clsx(styles.headerCell, layout.last && styles.lastColumn)}
        style={{ gridRow: 1, gridColumn: layout.column }}
      >
        <Text weight="medium" color="text-high">
          Split
        </Text>
      </div>
      {variations.map((v, i) => (
        <ColumnCell key={v.id} layout={layout} row={i}>
          <div className={clsx(styles.fieldLine, styles.splitField)}>
            {onChange ? (
              <PercentField
                value={split[i] ?? 0}
                commitOn="blur"
                decimals={VARIATION_WEIGHT_DECIMALS}
                onChange={(weight) => onChange(rebalance(split, i, weight))}
                ariaLabel={`${variationLabel(v)} split`}
                form={edits?.formId}
              />
            ) : (
              <Text>{decimalToPercent(split[i] ?? 0)}%</Text>
            )}
          </div>
        </ColumnCell>
      ))}
      {/* Not a ColumnFooter, which is never :empty, so an empty row collapses. */}
      <div
        className={clsx(styles.detailsCell, layout.last && styles.lastColumn)}
        style={{ gridRow: layout.detailsRow, gridColumn: layout.column }}
      >
        {note ? (
          <div className={styles.footerLine}>
            <Text size="sm" color="text-low">
              {note}
            </Text>
          </div>
        ) : onChange && !equal ? (
          <div className={styles.footerLine}>
            <Link
              size="sm"
              onClick={() => onChange(getEqualWeights(variations.length))}
            >
              Set equal
            </Link>
          </div>
        ) : null}
      </div>
    </>
  );
}

type ValueGroup = {
  ruleIds: string[];
  environments: string[];
  first: boolean;
};

type LinkAction = "relink" | "remove" | "keep";

type FlagColumnSource = {
  key: string;
  info: LinkedFeatureInfo;
  group: ValueGroup | null;
};

// Saves a removed flag's unlink once its column has left the table.
function StagedUnlink({
  featureId,
  discard,
}: {
  featureId: string;
  discard: () => void;
}) {
  useRegisterExperimentEdit(`link:${featureId}`, true, {
    label: `Remove ${featureId}`,
    changes: () => ({ unlinkFeatures: [featureId] }),
    discard,
  });
  return null;
}

function FlagColumn({
  layout,
  experiment,
  info,
  group,
  canEdit,
  flagEnvironments,
  draftPicks,
  linkAction,
  setLinkAction,
}: {
  layout: ColumnLayout;
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  group: ValueGroup | null;
  canEdit: boolean;
  flagEnvironments: FlagEnvironmentsDraft;
  draftPicks: FlagDraftPicks;
  linkAction: LinkAction | null;
  setLinkAction: (action: LinkAction | null) => void;
}) {
  const permissionsUtil = usePermissionsUtil();
  const [editEnvironments, setEditEnvironments] = useState(false);
  const { configs } = useDefinitions();
  const { variations } = layout;
  // Past a draft, a flag's values and environments edit on its own page.
  const showingLive = experiment.status !== "draft";
  const { feature } = info;
  const valuesEditId = `flag:${feature.id}${
    group ? `:${group.ruleIds.join(",")}` : ""
  }`;
  const [stagedFor, setStaged] = useStagedState<StagedFor | null>(
    valuesEditId,
    null,
  );
  const pick = draftPicks.value[feature.id];
  const holdsNew = stagedFor?.for === "new";
  const {
    drafts,
    draft: pendingDraft,
    target,
    launches: isLaunchDraft,
  } = useMemo(
    () => resolveDraftPick(info, pick, holdsNew),
    [info, pick, holdsNew],
  );

  const fromDraft = !!pendingDraft && target === "draft";
  const showsDraft = fromDraft && !showingLive;
  const workingOn = fromDraft ? pendingDraft.version : "new";
  const orphaned = info.state === "discarded";
  const relinking = linkAction === "relink";
  const pendingRemoval = info.pendingRemoval;
  const liveValues = info.liveValues ?? info.values;
  const liveSparse = info.liveSparse ?? info.sparse ?? false;
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

  const groupEnvironments = group
    ? group.environments.join(", ") || "no environments"
    : null;
  // Values staged for a draft since published or discarded stay, aimed at
  // what's open now; the save's conflict check says that draft moved.
  const aimsHere = (s: StagedFor | null): s is StagedFor =>
    !!s &&
    (s.for === workingOn ||
      (s.for !== "new" && !drafts.some((d) => d.version === s.for)));
  const staged = aimsHere(stagedFor) ? stagedFor : null;
  const pinTarget = (next: number | "new") =>
    draftPicks.set(feature.id, {
      newestVersion: drafts[0]?.version ?? null,
      target: next,
    });
  const chooseTarget = (next: number | "new") => {
    pinTarget(next);
    setStaged(null);
  };
  const stagedScope = group
    ? null
    : (flagEnvironments.value[feature.id] ?? null);
  const clearStaged = () => {
    setStaged(null);
    if (!group) flagEnvironments.set(feature.id, null);
  };
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

  const displayFeature = useMemo(
    () => ({ ...feature, valueType, defaultValue: sparseBase }),
    [feature, valueType, sparseBase],
  );
  const lockedBySchedule = fromDraft && pendingDraft.lockedBySchedule;
  const onFlag = info.state === "live" || info.state === "draft";
  const canEditFlagLinks =
    canEdit && permissionsUtil.canEditFeatureDrafts(feature);
  const canEditFlag = canEditFlagLinks && !pendingRemoval;
  const editable = canEditFlag && !lockedBySchedule && (onFlag || relinking);

  const stage = (patch: Partial<Staged>) => {
    if (typeof workingOn === "number" && pick?.target !== workingOn) {
      pinTarget(workingOn);
    }
    setStaged((prev) => {
      const kept = aimsHere(prev) ? prev : null;
      return {
        for: workingOn,
        values: { ...kept?.values, ...patch.values },
        sparse: patch.sparse ?? kept?.sparse,
      };
    });
  };

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

  // Per variation, JSON parsed so a review diffs it field by field.
  const reviewValues = (valueOf: (variationId: string) => string | undefined) =>
    Object.fromEntries(
      variations.map((v) => {
        const value = valueOf(v.id);
        let shown: unknown = value;
        if (valueType === "json" && value !== undefined) {
          try {
            shown = JSON.parse(value);
          } catch {
            shown = value;
          }
        }
        // Indexed: two variations can share a name.
        return [`${v.index}: ${variationLabel(v)}`, shown];
      }),
    );

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

  const loadedRevision = () =>
    fromDraft
      ? { version: pendingDraft.version, dateUpdated: pendingDraft.dateUpdated }
      : { version: feature.version, dateUpdated: null };
  const stagesValues = dirty && !linkAction && !showingLive;
  const [revisionBase, rebaseRevision] = useEditBase(
    valuesEditId,
    stagesValues,
    loadedRevision,
  );
  useRegisterExperimentEdit(valuesEditId, stagesValues, {
    label: `${feature.id} values${groupEnvironments ? ` (${groupEnvironments})` : ""}`,
    rebase: rebaseRevision,
    review: () => ({
      before: {
        values: reviewValues(storedValue),
        ...(sparse !== storedSparse && { sparse: storedSparse }),
      },
      after: {
        values: reviewValues(valueFor),
        ...(sparse !== storedSparse && { sparse }),
        ...(stagedScope && { environments: stagedScope }),
      },
    }),
    changes: (options) => ({
      flagValues: [
        {
          featureId: feature.id,
          variations: checkedValues(options),
          ...(sparse !== storedSparse && { sparse }),
          ...(stagedScope && { environments: stagedScope }),
          ...(group && { ruleIds: group.ruleIds }),
          revision: revisionBase ?? loadedRevision(),
        },
      ],
    }),
    discard: clearStaged,
  });

  const clearLinkAction = () => {
    setLinkAction(null);
    clearStaged();
  };
  useRegisterExperimentEdit(
    `link:${feature.id}`,
    !!linkAction && !showingLive && (!group || group.first),
    {
      label:
        linkAction === "keep" ? `Keep ${feature.id}` : `Link ${feature.id}`,
      changes: (options) =>
        linkAction === "keep"
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
      discard: clearLinkAction,
    },
  );

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
  const canChooseTarget = !!pendingDraft && (drafts.length > 1 || canStartNew);
  const launches = experiment.status === "draft";
  const launchDraft = drafts[0];
  const draftLaunches = launches && isLaunchDraft;
  const stageLinkAction = (action: LinkAction) => {
    clearStaged();
    setLinkAction(action);
  };

  const shownDraft = showsDraft ? pendingDraft : null;
  const problem = shownDraft?.hasMergeConflict
    ? "Merge conflict"
    : shownDraft?.rebaseRequired
      ? "Needs rebase"
      : draftLaunches && shownDraft?.hasUnrelatedDraftChanges
        ? "Changes beyond this experiment"
        : orphaned
          ? "Rule missing"
          : info.state === "archived"
            ? "Archived"
            : null;
  const needsApproval =
    !!shownDraft?.pendingApproval && !pendingDraftApproved(shownDraft);
  const approvalBypassed =
    !!shownDraft && startBypassCovers(experiment, feature.id, shownDraft);
  const cannotPublishLaunch =
    !!shownDraft && draftLaunches && !!info.cannotPublish;
  const draftHref = shownDraft
    ? draftReviewHref(feature.id, shownDraft.version)
    : `/features/${feature.id}`;
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
  const draftNotes: string[] = [];
  if (info.state === "archived") {
    notices.push(
      experiment.status === "running"
        ? {
            status: "warning",
            text: "Feature Flag is archived and is not serving.",
          }
        : launches
          ? {
              status: "warning",
              text: "Feature Flag is archived and won't serve on experiment start.",
            }
          : { status: "info", text: "This Feature Flag is archived." },
    );
  }
  if (shownDraft?.hasMergeConflict) {
    notices.push({
      status: "error",
      text: draftLaunches
        ? "Draft conflicts with live. Resolve before starting."
        : "Draft conflicts with live. Resolve before publishing.",
      action: draftLink("Fix conflicts"),
    });
  } else if (shownDraft?.rebaseRequired) {
    notices.push({
      status: "warning",
      text: "Draft is behind live. Update it to publish.",
      action: draftLink("Review draft"),
    });
  } else if (draftLaunches && shownDraft?.hasUnrelatedDraftChanges) {
    notices.push({
      status: "error",
      text: "Draft has changes unrelated to this experiment, which blocks start. Manually publish or remove unrelated changes.",
      action: draftLink("Review draft"),
    });
  } else if (shownDraft && !lockedBySchedule && !cannotPublishLaunch) {
    draftNotes.push(
      !isLaunchDraft && launchDraft
        ? `Only Revision ${launchDraft.version} publishes when the experiment starts. Publish ${draftMention} from the Feature Flag.`
        : needsApproval
          ? approvalBypassed
            ? `${draftMention} publishes when the experiment starts, its approval bypassed. Editing it means it needs approval first.`
            : `${draftMention} needs approval. Once approved, it publishes when the experiment starts.`
          : `${draftMention} publishes when the experiment starts, or publish it from the Feature Flag.`,
    );
  }
  if (cannotPublishLaunch) {
    notices.push({
      status: "error",
      text: hasPendingScheduledStart(experiment)
        ? "Whoever scheduled the experiment's start can no longer publish this draft. Reschedule as an authorized user."
        : "You don't have permission to publish this draft, so it won't publish at experiment start.",
      action: draftLink("Review draft"),
    });
  }
  if (lockedBySchedule) {
    draftNotes.push("Locked until its scheduled publish.");
  }
  const describesShown = showsDraft
    ? info.state === "draft" && pendingDraft.version === drafts[0]?.version
    : info.state === "live";
  if (!group && onFlag && describesShown && info.inconsistentValues) {
    notices.push({
      status: "warning",
      text: `This experiment is on the Feature Flag more than once with different values. Showing the first, from ${info.valuesFrom}.`,
    });
  }
  if (!showingLive && duplicateIds.size) {
    notices.push({
      status: "error",
      text: "Multiple variations serve the same value.",
    });
  }
  if (onFlag && describesShown && info.rulesAbove) {
    notices.push({
      status: "info",
      text: "Feature Flag has rules above the experiment's rule.",
    });
  }
  if (pendingRemoval && !linkAction) {
    notices.push({
      status: "warning",
      text: `Revision ${pendingRemoval.version} removes this experiment's rule.`,
      action: draftLink(
        "Review draft",
        draftReviewHref(feature.id, pendingRemoval.version),
      ),
    });
  }

  const liveInputs = info.liveEnvironmentInputs ?? info.environmentInputs;
  const liveStates = {
    environmentStates: info.liveEnvironmentStates ?? info.environmentStates,
  };
  const storedInputs = fromDraft ? pendingDraft.environmentInputs : liveInputs;
  const shownScope = showingLive ? null : stagedScope;
  const shownInputs = showsDraft ? pendingDraft.environmentInputs : liveInputs;
  const environmentInputs =
    shownInputs && stageEnvironmentInputs(shownInputs, shownScope);
  const environmentStates = getEnvironmentStates(
    shownScope && environmentInputs
      ? { environmentStates: linkedFeatureEnvStates(environmentInputs) }
      : showsDraft
        ? pendingDraft
        : liveStates,
  );
  const environmentsChanged =
    (showsDraft || !!shownScope) &&
    environmentStates.some(({ env }) => {
      const input = environmentInputs?.[env];
      if (!input) return false;
      const live = info.liveEnvironmentInputs?.[env];
      const liveEnabled =
        live?.flagEnabled ?? !!feature.environmentSettings?.[env]?.enabled;
      return (
        input.flagEnabled !== liveEnabled ||
        input.rule !== (live?.rule ?? "missing")
      );
    });
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
      : "Saving adds the rule to a new draft, published when the experiment starts.";

  const notLive = showingLive && !info.liveHasMatchingRule;
  const noValues = (orphaned && !relinking) || notLive;
  const showEnvironments =
    environmentStates.length > 0 && !orphaned && !notLive;
  const canEditEnvironments = canEditFlag && showEnvironments && !group;
  const startsDraft =
    !showsDraft && !showingLive && (editable || canChooseTarget);
  const revisionName = showsDraft
    ? revisionLabelText(
        pendingDraft.version,
        pendingDraft.title,
        !!pendingDraft.title,
      )
    : "New draft";
  const revisionStatus = showsDraft ? pendingDraft.status : "draft";
  const revisionNotes = showsDraft
    ? draftNotes
    : ["Saving starts a new draft of this Feature Flag."];
  const inReview = !!shownDraft && draftReviewState(shownDraft) !== "ready";
  const revisionDot = <StatusDot color={draftStatusDotColor(revisionStatus)} />;
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
        </Flex>
      }
    />
  );
  const revisionControl = revisionPicker ? (
    <Flex align="center" gap="1" minWidth="0">
      {revisionDetails(<Flex align="center">{revisionDot}</Flex>)}
      {revisionPicker}
    </Flex>
  ) : (
    revisionDetails(
      <Flex align="center" gap="1" minWidth="0" style={{ cursor: "default" }}>
        {revisionDot}
        <span className={styles.baselineText}>
          <Text size="sm" color="text-low" truncate>
            {revisionName}
          </Text>
        </span>
      </Flex>,
    )
  );
  const reviewItem =
    shownDraft && !inReview ? (
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
    canEditFlagLinks && !linkAction && !pendingRemoval && !orphaned ? (
      <DropdownMenuItem
        key="remove"
        color="red"
        onClick={() => stageLinkAction("remove")}
      >
        Remove from experiment
      </DropdownMenuItem>
    ) : null,
  ].filter(Boolean);
  const stagedLinkAction = (
    <StagedNote onUndo={clearLinkAction}>{linkActionNote}</StagedNote>
  );
  const orphanNote = (
    <Flex align="center" gap="3">
      <Box flexGrow="1" minWidth="0">
        <HelperText status="warning" size="sm">
          Feature Flag has no experiment rule.
        </HelperText>
      </Box>
      {canEditFlagLinks && !showingLive ? (
        <Flex gap="2" flexShrink="0">
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
    <ValueDiffProvider>
      {editingValues !== null ? (
        <FlagValuesModal
          feature={displayFeature}
          variations={variations}
          initialValues={Object.fromEntries(
            variations.map((v) => [v.id, valueFor(v.id) ?? ""]),
          )}
          initialSparse={sparse}
          sparseEligible={sparseEligible}
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
          environmentStates={getEnvironmentStates(
            fromDraft ? pendingDraft : liveStates,
          )}
          storedAllEnvironments={
            fromDraft
              ? (pendingDraft.allEnvironments ?? null)
              : (info.liveAllEnvironments ?? null)
          }
          environmentInputs={storedInputs}
          showFlag={false}
          close={() => setEditEnvironments(false)}
          apply={(scope) => {
            flagEnvironments.set(feature.id, scope);
            setEditEnvironments(false);
          }}
        />
      ) : null}

      <ColumnHeader
        layout={layout}
        icon={<PiFlag />}
        title={
          <>
            <HeaderText truncate>
              <Link
                href={
                  showingLive && pendingDraft
                    ? revisionHref(feature.id, pendingDraft.version)
                    : `/features/${feature.id}`
                }
                external
              >
                {feature.id}
              </Link>
            </HeaderText>
            {groupEnvironments ? (
              <Flex minWidth="0">
                <HeaderText muted small>
                  (
                </HeaderText>
                <HeaderText muted small truncate>
                  {groupEnvironments}
                </HeaderText>
                <HeaderText muted small>
                  )
                </HeaderText>
              </Flex>
            ) : null}
          </>
        }
        problem={problem}
        kind={
          <HeaderKind>
            <FeatureValueTypeDisplay
              valueType={valueType}
              baseConfig={feature.baseConfig}
              link={false}
              maxWidth={120}
            />
          </HeaderKind>
        }
        menu={menuItems}
        menuLabel={`${feature.id} actions`}
      />

      {noValues
        ? // Nothing to show; the column's note below says why.
          variations.map((v, i) => (
            <ColumnCell key={v.id} layout={layout} row={i} />
          ))
        : variations.map((v, i) => {
            const value = showingLive
              ? liveValues.find((l) => l.variationId === v.id)?.value
              : valueFor(v.id);
            const duplicate = !showingLive && duplicateIds.has(v.id);
            return (
              <ColumnCell key={v.id} layout={layout} row={i}>
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
              </ColumnCell>
            );
          })}

      <ColumnFooter
        layout={layout}
        start={
          showEnvironments ? (
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
          ) : null
        }
        end={
          !showingLive && !noValues && (showsDraft || startsDraft)
            ? revisionControl
            : null
        }
      >
        {noValues && !orphaned ? (
          <Text size="sm" color="text-low">
            {pendingDraft
              ? `Not on the live Feature Flag yet. ${draftMention} adds it.`
              : "Not on the live Feature Flag yet."}
          </Text>
        ) : linkAction && !showingLive ? (
          stagedLinkAction
        ) : noValues ? (
          orphanNote
        ) : null}
        {notices.map((n, i) => (
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
      </ColumnFooter>
    </ValueDiffProvider>
  );
}
