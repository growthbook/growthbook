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
import {
  ColumnCell,
  ColumnFooter,
  ColumnHeader,
  ColumnLayout,
  HeaderText,
  ImplementationColumn,
  StagedNote,
} from "./ImplementationColumn";
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
import FunnelConnector from "./FunnelConnector";
import {
  getDuplicateVariationIds,
  repairVariationValues,
  variationLabel,
} from "./variationValues";
import styles from "./VariationValuesTable.module.scss";

export type FlagView = "draft" | "live";

export const FUNNEL_WIDTH = 692;
const VARIATION_MIN_WIDTH = 180;
const VARIATION_NARROWEST_WIDTH = 130;
const SPLIT_WIDTH = 124;
const FLAG_WIDTH = 280;
const BORDERS = 2;

const VALUE_TYPE_LABELS: Record<FeatureValueType, string> = {
  boolean: "Boolean",
  number: "Number",
  string: "String",
  json: "JSON",
};

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
  canEditFlagValues: boolean;
  flagEnvironments?: FlagEnvironmentsDraft;
  draftPicks: FlagDraftPicks;
  flagView: FlagView;
  onChangeFlagView?: ((view: FlagView) => void) | null;
  split: number[];
  onChangeSplit?: ((split: number[]) => void) | null;
  splitNote?: string | null;
  onEditKeys?: () => void;
  onRemoveVariation?: (variationIndex: number) => void;
  onReorder?: () => void;
  onAddVariation?: () => void;
  implementationColumns?: ImplementationColumn[];
  addImplementation?: ReactNode;
}

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
  implementationColumns = [],
  addImplementation = null,
}: Props) {
  const variations = getLatestPhaseVariations(experiment);
  const hasMenu = !!(onEditKeys || onRemoveVariation || onReorder);
  const columnCount = linkedFeatures.length + implementationColumns.length;
  const columns = [
    `minmax(${VARIATION_NARROWEST_WIDTH}px, 1fr)`,
    `${SPLIT_WIDTH}px`,
    ...Array(columnCount).fill(`${FLAG_WIDTH}px`),
  ].join(" ");
  const tableWidth = Math.max(
    FUNNEL_WIDTH - BORDERS,
    VARIATION_MIN_WIDTH + SPLIT_WIDTH + columnCount * FLAG_WIDTH,
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
    showingLive: flagView === "live",
  });
  const [scrolled, setScrolled] = useState(false);

  if (!variations.length) return null;

  return (
    <Box mx="auto" style={{ width: tableWidth + BORDERS, maxWidth: "100%" }}>
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
        <Flex justify="end" align="center" pt="3" pb="2" minHeight="22px">
          {onChangeFlagView ? (
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
          ) : null}
        </Flex>
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
            <div
              className={clsx(styles.detailsCell, styles.pinnedStart)}
              style={{ gridRow: detailsRow, gridColumn: 1 }}
            >
              {onAddVariation ? (
                <Flex>
                  <Link onClick={onAddVariation}>
                    <Flex
                      align="center"
                      gap="1"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      <PiPlus />
                      Add variation
                    </Flex>
                  </Link>
                </Flex>
              ) : null}
            </div>

            <SplitColumn
              column={2}
              last={!columnCount}
              firstValueRow={firstValueRow}
              detailsRow={detailsRow}
              variations={variations}
              split={split}
              onChange={onChangeSplit}
              note={splitNote}
            />

            {linkedFeatures.map((info, i) => (
              <div
                key={info.feature.id}
                className={styles.implementationColumn}
              >
                <FlagColumn
                  layout={layoutFor(i)}
                  experiment={experiment}
                  info={info}
                  canEdit={canEditFlagValues}
                  flagEnvironments={flagEnvironments}
                  draftPicks={draftPicks}
                />
              </div>
            ))}
            {implementationColumns.map((c, i) => (
              <div key={c.key} className={styles.implementationColumn}>
                {c.render(layoutFor(linkedFeatures.length + i))}
              </div>
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
        <Text weight="medium" color="text-high">
          Split
        </Text>
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
  layout,
  experiment,
  info,
  canEdit,
  flagEnvironments,
  draftPicks,
}: {
  layout: ColumnLayout;
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  canEdit: boolean;
  flagEnvironments?: FlagEnvironmentsDraft;
  draftPicks: FlagDraftPicks;
}) {
  const permissionsUtil = usePermissionsUtil();
  const [editEnvironments, setEditEnvironments] = useState(false);
  const { configs } = useDefinitions();
  const { variations, showingLive } = layout;
  const { feature } = info;
  const pick = draftPicks.value[feature.id];
  const {
    drafts,
    draft: pendingDraft,
    target,
    launches: isLaunchDraft,
  } = useMemo(() => resolveDraftPick(info, pick), [info, pick]);

  const fromDraft = !!pendingDraft && target === "draft";
  const showsDraft = fromDraft && !showingLive;
  const workingOn = fromDraft ? pendingDraft.version : "new";
  const orphaned = info.state === "discarded";
  const [linkAction, setLinkAction] = useStagedState<
    "relink" | "remove" | "keep" | null
  >(`link:${feature.id}`, null);
  const relinking = linkAction === "relink";
  const removing = linkAction === "remove";
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
  const stagedScope = flagEnvironments?.value[feature.id] ?? null;
  const clearStaged = () => {
    setStaged(null);
    flagEnvironments?.set(feature.id, null);
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
  const editable =
    canEdit &&
    !pendingRemoval &&
    !lockedBySchedule &&
    permissionsUtil.canEditFeatureDrafts(feature) &&
    (onFlag || relinking) &&
    !removing;

  const stage = (patch: Partial<Staged>) => {
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
  const canEditFlag =
    canEdit && !pendingRemoval && permissionsUtil.canEditFeatureDrafts(feature);
  const canEditFlagLinks =
    canEdit && permissionsUtil.canEditFeatureDrafts(feature);
  const launches = experiment.status === "draft";
  const removeBlocked = experiment.status === "running";
  const launchDraft = drafts[0];
  const draftLaunches = launches && isLaunchDraft;
  const stageLinkAction = (action: "relink" | "remove" | "keep") => {
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
  const describesShown = showsDraft
    ? info.state === "draft" && pendingDraft.version === drafts[0]?.version
    : info.state === "live";
  if (onFlag && describesShown && info.inconsistentValues) {
    notices.push({
      status: "warning",
      text: `This experiment is on the Feature Flag more than once with different values. Showing the first, from ${info.valuesFrom}.`,
    });
  }
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

  const notLive = showingLive && !info.liveHasMatchingRule;
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
          {inReview ? (
            <Text size="sm">
              {draftLink("Review & Publish", draftHref, "hover")}
            </Text>
          ) : null}
        </Flex>
      }
    />
  );
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
  const stagedLinkAction = (
    <StagedNote onUndo={clearLinkAction}>{linkActionNote}</StagedNote>
  );
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

      <ColumnHeader
        layout={layout}
        icon={<PiFlag />}
        title={
          <HeaderText truncate>
            <Link href={`/features/${feature.id}`} external>
              {feature.id}
            </Link>
          </HeaderText>
        }
        problem={problem}
        kind={VALUE_TYPE_LABELS[valueType]}
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
        end={noValues ? null : revisionControl}
      >
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
      </ColumnFooter>
    </>
  );
}
