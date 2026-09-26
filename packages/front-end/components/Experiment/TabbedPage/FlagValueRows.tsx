import clsx from "clsx";
import { ReactNode, useMemo, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { FeatureValueType } from "shared/types/feature";
import {
  castFeatureValue,
  getConfigSubtree,
  getFeatureBaseConfigKey,
  isManagedByExperiment,
  parsePlainJSONObject,
} from "shared/util";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import {
  PiArrowSquareOut,
  PiCaretDownFill,
  PiFlag,
  PiPencilSimple,
  PiPlus,
  PiWarningFill,
} from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import ForceSummary from "@/components/Features/ForceSummary";
import FeatureValueField from "@/components/Features/FeatureValueField";
import UnpublishedDot from "@/components/Experiment/UnpublishedDot";
import { getVariationValueChanges } from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import {
  EnvironmentInputsPopover,
  getEnvironmentStates,
  scopeFromStates,
  stageEnvironmentInputs,
  statesFromInputs,
} from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import EditExperimentEnvironmentsModal from "@/components/Experiment/EditExperimentEnvironmentsModal";
import { useAuth } from "@/services/auth";
import {
  VARIATION_GRID_COLUMNS,
  variationGridMaxWidth,
} from "@/components/Experiment/VariationsTable";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Reviews/RevisionLabel";
import RevisionStatusBadge from "@/components/Reviews/RevisionStatusBadge";
import ReviewFeedbackPopover from "@/components/Reviews/ReviewFeedbackPopover";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import VariationNumber from "@/ui/VariationNumber";
import ImplementationHeading from "@/components/Experiment/ImplementationHeading";
import { ActionsOverlay } from "@/components/Features/CornerActions";
import {
  blockedExperimentValueTypes,
  EXPERIMENT_VALUE_TYPE_ORDER,
  VALUE_TYPE_LABELS,
} from "@/components/Features/valueTypes";
import cornerStyles from "@/components/Features/CornerActions.module.scss";
import {
  FlagEnvironmentsDraft,
  useRegisterExperimentEdit,
} from "./ExperimentEdits";
import FlagValuesModal from "./FlagValuesModal";
import {
  getDuplicateVariationIds,
  repairVariationValues,
  variationLabel,
} from "./variationValues";
import styles from "./FlagValueRows.module.scss";

// Tight to each value's bottom-right corner, shown on hover.
const JSON_ACTIONS: ActionsOverlay = {
  revealOnHover: true,
  style: { bottom: -9, right: 2, gap: "var(--space-2)" },
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

// A slim, underlined menu trigger: the current choice and a caret.
function CaretTrigger({
  children,
  color,
}: {
  children: ReactNode;
  color?: "dark";
}) {
  return (
    <Link color={color}>
      <Flex align="center" gap="1">
        <Text size="sm">{children}</Text>
        <PiCaretDownFill size={10} />
      </Flex>
    </Link>
  );
}

type Staged = {
  values: Record<string, string>;
  valueType?: FeatureValueType;
  sparse?: boolean;
};

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  canEdit: boolean;
  /** Show what is live rather than the draft, read-only. */
  showLive?: boolean;
  mutate: () => void;
  /** Links another Feature Flag, offered under the last one. */
  onAddFlag?: (() => void) | null;
  /** Environment scopes staged per flag. */
  flagEnvironments?: FlagEnvironmentsDraft;
}

/** One row per linked Feature Flag, a cell per variation, under the variation cards. */
export default function FlagValueRows({
  experiment,
  linkedFeatures,
  canEdit,
  showLive = false,
  mutate,
  onAddFlag,
  flagEnvironments,
}: Props) {
  const variations = getLatestPhaseVariations(experiment);
  const cols = Math.min(variations.length, 3);

  if (!linkedFeatures.length || !variations.length) return null;

  const managedFlags = linkedFeatures.filter((info) =>
    isManagedByExperiment(info.feature, experiment.id),
  );
  const linkedFlags = linkedFeatures.filter(
    (info) => !managedFlags.includes(info),
  );

  return (
    <Flex
      direction="column"
      gap="4"
      mt="4"
      mx="auto"
      width="100%"
      style={{ maxWidth: variationGridMaxWidth(cols) }}
    >
      {/* Values first: the experiment's own flag, then linked ones. */}
      {managedFlags.map((info) => (
        <FlagValueRow
          key={info.feature.id}
          experiment={experiment}
          info={info}
          canEdit={canEdit}
          showLive={showLive}
          mutate={mutate}
          flagEnvironments={flagEnvironments}
        />
      ))}
      {linkedFlags.length ? (
        <ImplementationHeading inList>Feature Flags</ImplementationHeading>
      ) : null}
      {linkedFlags.map((info) => (
        <FlagValueRow
          key={info.feature.id}
          experiment={experiment}
          info={info}
          canEdit={canEdit}
          showLive={showLive}
          mutate={mutate}
          flagEnvironments={flagEnvironments}
        />
      ))}
      {onAddFlag ? (
        <Flex justify="end">
          <Button variant="outline" icon={<PiPlus />} onClick={onAddFlag}>
            Add Feature Flag
          </Button>
        </Flex>
      ) : null}
    </Flex>
  );
}

function FlagValueRow({
  experiment,
  info,
  canEdit,
  showLive,
  mutate,
  flagEnvironments,
}: {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  canEdit: boolean;
  showLive: boolean;
  mutate: () => void;
  flagEnvironments?: FlagEnvironmentsDraft;
}) {
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const [editEnvironments, setEditEnvironments] = useState(false);
  const { configs } = useDefinitions();
  const variations = getLatestPhaseVariations(experiment);
  const { feature, pendingDraft } = info;

  const managed = isManagedByExperiment(feature, experiment.id);
  // A second draft is only worth starting when the open one also holds
  // changes that can't publish with the experiment; otherwise start would
  // stack both. A managed flag keeps one draft.
  const canStartSeparateDraft =
    !managed && !!pendingDraft?.hasUnrelatedDraftChanges;
  const [target, setTarget] = useState<"draft" | "new">(
    pendingDraft ? "draft" : "new",
  );
  const fromDraft = !!pendingDraft && !showLive && target === "draft";
  const values = fromDraft
    ? pendingDraft.values
    : (info.liveValues ?? info.values);
  const storedSparse = fromDraft
    ? pendingDraft.sparse
    : (info.liveSparse ?? info.sparse ?? false);
  const storedType = fromDraft ? pendingDraft.valueType : feature.valueType;
  const storedDefault = fromDraft
    ? pendingDraft.defaultValue
    : feature.defaultValue;

  const [staged, setStaged] = useState<Staged | null>(null);
  // Environments are staged above the row: the funnel's header edits them too.
  const stagedScope = flagEnvironments?.value[feature.id] ?? null;
  const clearStaged = () => {
    setStaged(null);
    flagEnvironments?.set(feature.id, null);
  };
  // The variation to focus when the values editor opens; undefined = closed.
  const [editingValues, setEditingValues] = useState<string | null>();
  const storedValue = (variationId: string) =>
    values.find((v) => v.variationId === variationId)?.value;
  const valueFor = (variationId: string) =>
    staged?.values[variationId] ?? storedValue(variationId);
  const valueType = staged?.valueType ?? storedType;
  const sparse = staged?.sparse ?? storedSparse;

  // A managed flag's default is its control value, so that is what the other
  // variations patch onto.
  const controlId = variations[0]?.id;
  const sparseBase =
    (managed && controlId ? valueFor(controlId) : undefined) ??
    storedDefault ??
    "";
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
    () => ({ ...feature, valueType, defaultValue: sparseBase }),
    [feature, valueType, sparseBase],
  );
  const draftIds = useMemo(
    () =>
      new Set(
        fromDraft
          ? getVariationValueChanges(
              info,
              variations.map((v) => v.id),
            )
              .filter((c) => c.unpublished)
              .map((c) => c.variationId)
          : [],
      ),
    [info, variations, fromDraft],
  );

  const lockedBySchedule = fromDraft && pendingDraft.lockedBySchedule;
  const onFlag = info.state === "live" || info.state === "draft";
  const editable =
    canEdit &&
    !showLive &&
    !lockedBySchedule &&
    permissionsUtil.canEditFeatureDrafts(feature) &&
    onFlag;

  const stage = (patch: Partial<Staged>) =>
    setStaged((prev) => ({
      values: { ...prev?.values, ...patch.values },
      valueType: patch.valueType ?? prev?.valueType,
      sparse: patch.sparse ?? prev?.sparse,
    }));

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
    variations.map((v) => ({ variationId: v.id, value: valueFor(v.id) })),
    valueType,
    sparse,
    sparseBase,
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
  // second save, so nothing lands that the user hasn't seen.
  const checkedValues = () => {
    const { checked, repaired } = repairVariationValues(
      { valueType, jsonSchema: feature.jsonSchema },
      variations,
      valueFor,
      (v) => `${feature.id}, ${variationLabel(v)}`,
    );
    if (Object.keys(repaired).length) {
      stage({ values: repaired });
      throw new Error(
        `We fixed some errors in the ${feature.id} values. If they look correct, save again.`,
      );
    }
    return checked;
  };

  useRegisterExperimentEdit(`flag:${feature.id}`, dirty, {
    changes: () => ({
      flagValues: [
        {
          featureId: feature.id,
          variations: checkedValues(),
          ...(valueType !== storedType && { valueType }),
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

  // Like the revision dropdown: a titled draft keeps its number in front.
  const draftLabel = pendingDraft
    ? revisionLabelText(
        pendingDraft.version,
        pendingDraft.title,
        !!pendingDraft.title,
      )
    : null;
  const draftRevision = pendingDraft ? (
    <RevisionLabel
      version={pendingDraft.version}
      title={pendingDraft.title}
      numbered={!!pendingDraft.title}
      minWidth={0}
      numberSize="inherit"
      inheritNumberColor
    />
  ) : null;
  const draftName = draftRevision ? (
    <Box as="span" display="block" maxWidth="180px">
      <Text truncate>{draftRevision}</Text>
    </Box>
  ) : null;
  const targetLabel = showLive ? "Live" : fromDraft ? draftName : "New draft";
  const targetTooltip = fromDraft ? (
    <Box>
      <Text size="sm">Changes here belong to feature revision:</Text>
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
    "Changes here start a new feature revision."
  ) : null;
  const canChooseTarget = canStartSeparateDraft && !showLive && canEdit;

  const targetControl =
    canChooseTarget && pendingDraft ? (
      <DropdownMenu
        trigger={
          <Tooltip content={targetTooltip} enabled={!!targetTooltip}>
            <span>
              <CaretTrigger>{targetLabel}</CaretTrigger>
            </span>
          </Tooltip>
        }
        menuPlacement="end"
        variant="soft"
      >
        <DropdownMenuItem
          onClick={() => {
            setTarget("draft");
            setStaged(null);
          }}
        >
          {draftName}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setTarget("new");
            setStaged(null);
          }}
        >
          New draft
        </DropdownMenuItem>
      </DropdownMenu>
    ) : (
      <Tooltip content={targetTooltip} enabled={!!targetTooltip}>
        {/* The trigger takes the hover handlers, so it must be a plain element. */}
        <span
          style={{ display: "inline-flex" }}
          className={styles.revisionLabel}
        >
          <Text size="sm" color="text-low">
            {targetLabel}
          </Text>
        </span>
      </Tooltip>
    );

  const canEditFlag = canEdit && permissionsUtil.canEditFeatureDrafts(feature);
  const launches = experiment.status === "draft";
  const canRemove = canEditFlag && launches;
  const removeFromExperiment = async () => {
    if (!confirm(`Remove ${feature.id} from this experiment?`)) return;
    await apiCall(`/experiment/${experiment.id}/linked-feature/${feature.id}`, {
      method: "DELETE",
    });
    mutate();
  };

  // Only a problem wears the warning; any other state is the revision's own.
  const shownDraft = fromDraft ? pendingDraft : null;
  const problem = shownDraft?.hasMergeConflict
    ? "Merge conflict"
    : shownDraft?.rebaseRequired
      ? "Needs rebase"
      : shownDraft?.hasUnrelatedDraftChanges
        ? "Changes beyond this experiment"
        : info.state === "discarded"
          ? "Draft discarded"
          : info.state === "archived"
            ? "Archived"
            : null;
  const needsApproval =
    !!shownDraft?.pendingApproval &&
    !(shownDraft.approval?.satisfied ?? shownDraft.status === "approved");
  const draftHref = shownDraft
    ? `/features/${feature.id}?v=${shownDraft.version}`
    : `/features/${feature.id}`;

  // A new tab, so following it never costs the page's unsaved edits.
  const draftLink = (label: string) => (
    <Link href={draftHref} external underline="always">
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
    notices.push({
      status: "warning",
      text: "This Feature Flag is archived. Unarchive it to make this experiment active.",
    });
  }
  if (info.state === "discarded") {
    notices.push({
      status: "warning",
      text: "The draft that linked this experiment was discarded, so its rule is no longer queued.",
      action: canEditFlag ? (
        <Link onClick={removeFromExperiment}>Remove from experiment</Link>
      ) : undefined,
    });
  }
  // A managed flag's draft is reviewed and published through the
  // experiment's own flow, so none of the flag-page routes apply.
  if (!managed) {
    if (shownDraft?.hasMergeConflict) {
      notices.push({
        status: "error",
        text: "This draft conflicts with live and can't publish until that's resolved.",
        action: draftLink("Fix conflicts"),
      });
    } else if (shownDraft?.rebaseRequired) {
      notices.push({
        status: "warning",
        text: "Live has moved on since this draft. Update it from live before it can publish.",
        action: draftLink("Review draft"),
      });
    } else if (shownDraft?.hasUnrelatedDraftChanges) {
      notices.push({
        status: "error",
        text: launches
          ? "This draft also changes things outside this experiment, so it won't publish when the experiment starts. Remove those edits, or publish the draft from the Feature Flag."
          : "This draft also changes things outside this experiment. Publish it from the Feature Flag.",
        action: draftLink("Review draft"),
      });
    } else if (shownDraft && !lockedBySchedule) {
      notices.push({
        status: "info",
        text: needsApproval
          ? launches
            ? "Needs approval. Once approved, it publishes when the experiment starts."
            : "Needs approval before it can publish."
          : launches
            ? "Publishes when the experiment starts, or publish it from the Feature Flag."
            : "Publish it from the Feature Flag to change what this experiment serves.",
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
  if (onFlag && info.inconsistentValues) {
    notices.push({
      status: "warning",
      text: `This experiment is on the flag more than once with different values. Showing the first, from ${info.valuesFrom}.`,
    });
  }
  if (onFlag && info.rulesAbove) {
    notices.push({
      status: "info",
      text: "Rules above this experiment on the flag may catch some users first.",
    });
  }

  const storedInputs = fromDraft
    ? pendingDraft.environmentInputs
    : (info.liveEnvironmentInputs ?? info.environmentInputs);
  const environmentInputs =
    storedInputs && stageEnvironmentInputs(storedInputs, stagedScope);
  const environmentStates = getEnvironmentStates(
    stagedScope && environmentInputs
      ? { environmentStates: statesFromInputs(environmentInputs) }
      : fromDraft
        ? pendingDraft
        : {
            environmentStates:
              info.liveEnvironmentStates ?? info.environmentStates,
          },
    {
      future:
        experiment.status !== "running"
          ? "started"
          : fromDraft
            ? "published"
            : false,
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
    if ((!fromDraft && !stagedScope) || !input) {
      return { flag: false, rule: false };
    }
    const live = liveInput(env);
    return {
      flag: input.flagEnabled !== live.flagEnabled,
      rule: input.rule !== live.rule,
    };
  };
  const changedEnvironments = Object.fromEntries(
    environmentStates.map(({ env }) => [env, changedInputs(env)]),
  );
  const environmentsChanged = Object.values(changedEnvironments).some(
    (c) => c.flag || c.rule,
  );
  // Only a change the draft makes needs saying when it lands.
  const environmentsTiming = !environmentsChanged
    ? null
    : `${fromDraft ? `From ${draftLabel}. ` : ""}${
        launches
          ? "Takes effect when it's published, or when the experiment starts."
          : "Takes effect when it's published."
      }`;

  // JSON is too big to edit in a cell, so it opens the values editor.
  const isJson = valueType === "json";

  const typeBlocked = blockedExperimentValueTypes(variations.length);
  const valueTypeControl = editable ? (
    <DropdownMenu
      trigger={
        <CaretTrigger color="dark">{VALUE_TYPE_LABELS[valueType]}</CaretTrigger>
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
    <Text size="sm">{VALUE_TYPE_LABELS[valueType]}</Text>
  );

  return (
    <>
      {managed ? (
        <ImplementationHeading
          inList
          action={
            <Flex align="center" gap="1">
              <Text size="sm" color="text-low">
                Type:
              </Text>
              {valueTypeControl}
            </Flex>
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
        {editingValues !== undefined ? (
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
            close={() => setEditingValues(undefined)}
            focusVariationId={editingValues}
            apply={({ values: next, sparse: nextSparse }) => {
              stage({ values: next, sparse: nextSparse });
              setEditingValues(undefined);
            }}
          />
        ) : null}
        {editEnvironments ? (
          <EditExperimentEnvironmentsModal
            experiment={experiment}
            info={info}
            scope={
              stagedScope ??
              scopeFromStates(
                Object.fromEntries(
                  environmentStates.map((e) => [e.env, e.state]),
                ),
                environmentStates.map((e) => e.env),
              )
            }
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
                reviewHref={draftHref}
              >
                <RevisionStatusBadge
                  revision={shownDraft}
                  liveVersion={feature.version}
                />
              </ReviewFeedbackPopover>
            ) : (
              <RevisionStatusBadge
                revision={
                  shownDraft ?? {
                    version: feature.version,
                    status: "published",
                  }
                }
                liveVersion={feature.version}
              />
            )}
            <Flex align="center" gap="3" ml="auto">
              <Flex align="center" gap="1">
                {environmentStates.length ? (
                  <EnvironmentInputsPopover
                    environmentStates={environmentStates}
                    environmentInputs={environmentInputs}
                    changed={changedEnvironments}
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
              <Box
                style={{
                  width: 1,
                  alignSelf: "stretch",
                  background: "var(--gray-a5)",
                }}
              />
              <Box mr="2">{targetControl}</Box>
              {pendingDraft || canRemove ? (
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
                  {pendingDraft ? (
                    <DropdownMenuItem>
                      <Link
                        href={`/features/${feature.id}?v=${pendingDraft.version}`}
                        external
                        color="dark"
                      >
                        Review {draftLabel}
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  {canRemove ? (
                    <DropdownMenuItem
                      color="red"
                      onClick={removeFromExperiment}
                    >
                      Remove from experiment
                    </DropdownMenuItem>
                  ) : null}
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
        {/* Top-aligned, so a tall JSON value doesn't push its neighbours down. */}
        <Grid columns={VARIATION_GRID_COLUMNS} gap="4" align="start">
          {variations.map((v) => {
            const value = valueFor(v.id);
            // On the value's corner, so it takes no room in the row.
            const draftDot =
              draftIds.has(v.id) && staged?.values[v.id] === undefined ? (
                <Box
                  position="absolute"
                  style={{ top: -3, right: -3, zIndex: 1, lineHeight: 0 }}
                >
                  <UnpublishedDot tooltip="Unpublished draft value" />
                </Box>
              ) : null;
            // A linked string's constant picker sits beside it, so the field
            // itself carries the dot.
            const dotOnField = !managed && editable && valueType === "string";
            const duplicate = duplicateIds.has(v.id);
            // Managed values fill their card, framed like a field even when
            // read-only; linked read-only scalars stay bare text.
            const framed = isJson || managed;
            return (
              <Flex
                key={v.id}
                align="start"
                gap="2"
                px={managed ? "0" : "3"}
                minWidth="0"
              >
                {managed ? null : (
                  // On a one-line field's centre line.
                  <Box flexShrink="0" mt="2">
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
                          isJson || valueType === "string" || !editable
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
                      valueType={valueType}
                      feature={displayFeature}
                      useDropdown
                      inlineConstantButton={!managed}
                      inlineConstantButtonSize="1"
                      actionsOverlay={
                        managed ? MANAGED_STRING_ACTIONS : STRING_ACTIONS
                      }
                      fieldOverlay={dotOnField ? draftDot : undefined}
                      outlineStyle={duplicate ? "error" : undefined}
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
                          sparse={sparse && !(managed && v.id === controlId)}
                          fontSize="0.7rem"
                          lineHeight={1.3}
                          actionsOverlay={JSON_ACTIONS}
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
                  {dotOnField ? null : draftDot}
                </Box>
              </Flex>
            );
          })}
        </Grid>
      </Box>
    </>
  );
}
