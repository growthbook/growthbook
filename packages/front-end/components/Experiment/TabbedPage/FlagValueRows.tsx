import clsx from "clsx";
import { Fragment, ReactNode, useMemo, useState } from "react";
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
  validateFeatureValue,
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
import {
  FaCircleCheck,
  FaCircleXmark,
  FaRegCircleCheck,
  FaRegCircleXmark,
} from "react-icons/fa6";
import ForceSummary from "@/components/Features/ForceSummary";
import FeatureValueField from "@/components/Features/FeatureValueField";
import UnpublishedDot from "@/components/Experiment/UnpublishedDot";
import { getVariationValueChanges } from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import { getEnvironmentStates } from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import EditExperimentEnvironmentsModal from "@/components/Experiment/EditExperimentEnvironmentsModal";
import { useAuth } from "@/services/auth";
import { Popover } from "@/ui/Popover";
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
import { ActionsOverlay } from "@/components/Features/actionsOverlay";
import { useRegisterExperimentEdit } from "./ExperimentEdits";
import FlagValuesModal from "./FlagValuesModal";
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

const TYPE_NAMES: Record<FeatureValueType, string> = {
  string: "String",
  number: "Number",
  json: "JSON",
  boolean: "Boolean",
};

const VALUE_TYPE_ORDER: FeatureValueType[] = [
  "string",
  "json",
  "number",
  "boolean",
];

const ENVIRONMENT_STATE_LABELS: Record<string, string> = {
  active: "Active",
  "disabled-env": "Off",
  "disabled-rule": "Off",
  missing: "Not included",
};

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
}

/** One row per linked Feature Flag, a cell per variation, under the variation cards. */
export default function FlagValueRows({
  experiment,
  linkedFeatures,
  canEdit,
  showLive = false,
  mutate,
  onAddFlag,
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
        />
      ))}
      {linkedFlags.length ? (
        // The list's gap already spaces it; pull the rows up under it.
        <ImplementationHeading mt="2" mb="-2">
          Feature Flags
        </ImplementationHeading>
      ) : null}
      {linkedFlags.map((info) => (
        <FlagValueRow
          key={info.feature.id}
          experiment={experiment}
          info={info}
          canEdit={canEdit}
          showLive={showLive}
          mutate={mutate}
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
}: {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  canEdit: boolean;
  showLive: boolean;
  mutate: () => void;
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
  // Only a flag that is JSON already: a re-type in the same edit has no base yet.
  const sparseEligible =
    !configKey &&
    valueType === "json" &&
    storedType === "json" &&
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

  const lockedBySchedule = fromDraft && !!pendingDraft?.lockedBySchedule;
  const editable =
    canEdit &&
    !showLive &&
    !lockedBySchedule &&
    permissionsUtil.canEditFeatureDrafts(feature) &&
    (info.state === "live" || info.state === "draft");

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

  const dirty =
    !!staged &&
    (valueType !== storedType ||
      sparse !== storedSparse ||
      Object.entries(staged.values).some(
        ([id, value]) => value !== storedValue(id),
      ));

  // Like the values modal: repair loose values in place, then ask for a
  // second save, so nothing lands that the user hasn't seen.
  const checkedValues = () => {
    const checked = variations.map((v) => ({
      variationId: v.id,
      value: validateFeatureValue(
        { valueType, jsonSchema: feature.jsonSchema },
        valueFor(v.id) ?? "",
        `${feature.id}, ${v.name || `Variation ${v.index}`}`,
      ),
    }));
    const repaired = checked.filter((c) => c.value !== valueFor(c.variationId));
    if (repaired.length) {
      stage({
        values: Object.fromEntries(
          repaired.map((c) => [c.variationId, c.value]),
        ),
      });
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
    onSaved: () => setStaged(null),
    discard: () => setStaged(null),
  });

  // Like the revision dropdown: a titled draft keeps its number in front.
  const draftLabel = pendingDraft
    ? revisionLabelText(
        pendingDraft.version,
        pendingDraft.title,
        !!pendingDraft.title,
      )
    : null;
  const draftName = pendingDraft ? (
    <span
      style={{
        display: "block",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        maxWidth: 180,
      }}
    >
      <RevisionLabel
        version={pendingDraft.version}
        title={pendingDraft.title}
        numbered={!!pendingDraft.title}
        minWidth={0}
        numberSize="inherit"
        numberColor="inherit"
      />
    </span>
  ) : null;
  const targetLabel = showLive ? "Live" : fromDraft ? draftName : "New draft";
  const targetTooltip = fromDraft ? (
    <Box>
      <Text size="sm">Changes here belong to feature revision:</Text>
      <Box>
        <Text size="sm" weight="semibold">
          <RevisionLabel
            version={pendingDraft.version}
            title={pendingDraft.title}
            numbered={!!pendingDraft.title}
            minWidth={0}
            numberSize="inherit"
            numberColor="inherit"
          />
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
  const canChooseTarget =
    canStartSeparateDraft && (editable || (!showLive && canEdit));

  const targetControl =
    canChooseTarget && pendingDraft ? (
      <DropdownMenu
        trigger={
          <Link>
            <Tooltip content={targetTooltip} enabled={!!targetTooltip}>
              <Flex align="center" gap="1">
                <Text size="sm">{targetLabel}</Text>
                <PiCaretDownFill size={10} />
              </Flex>
            </Tooltip>
          </Link>
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
  const canRemove = canEditFlag && experiment.status === "draft";
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
  const launches = experiment.status === "draft";

  // A new tab, so following it never costs the page's unsaved edits.
  const draftLink = (label: string) => (
    <Link href={draftHref} external underline="always">
      {label}
      <PiArrowSquareOut style={{ marginLeft: "var(--space-1)" }} />
    </Link>
  );

  // Everything the flag's own card used to say, one line each.
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
  if (
    (info.state === "live" || info.state === "draft") &&
    info.inconsistentValues
  ) {
    notices.push({
      status: "warning",
      text: `This experiment is on the flag more than once with different values. Showing the first, from ${info.valuesFrom}.`,
    });
  }
  if ((info.state === "live" || info.state === "draft") && info.rulesAbove) {
    notices.push({
      status: "info",
      text: "Rules above this experiment on the flag may catch some users first.",
    });
  }

  const environmentStates = getEnvironmentStates(
    (fromDraft
      ? pendingDraft
      : info.liveEnvironmentStates
        ? { environmentStates: info.liveEnvironmentStates }
        : info) ?? { environmentStates: {} },
    {
      future:
        experiment.status !== "running"
          ? "started"
          : fromDraft
            ? "published"
            : false,
    },
  );
  const activeEnvironments = environmentStates.filter((e) => e.isActive);
  const environmentInputs = fromDraft
    ? pendingDraft?.environmentInputs
    : (info.liveEnvironmentInputs ?? info.environmentInputs);
  // What the draft moves, against live; before live has the rule, against the
  // flag's own toggles with no rule.
  const liveInput = (env: string) =>
    info.liveEnvironmentInputs?.[env] ?? {
      flagEnabled: !!feature.environmentSettings?.[env]?.enabled,
      rule: "missing" as const,
    };
  const changedInputs = (env: string) => {
    const input = environmentInputs?.[env];
    if (!fromDraft || !input) return { flag: false, rule: false };
    const live = liveInput(env);
    return {
      flag: input.flagEnabled !== live.flagEnabled,
      rule: input.rule !== live.rule,
    };
  };
  const environmentsChanged = environmentStates.some(({ env }) => {
    const c = changedInputs(env);
    return c.flag || c.rule;
  });
  // Only a change the draft makes needs saying when it lands.
  const environmentsTiming = !environmentsChanged
    ? null
    : experiment.status === "draft"
      ? `From ${draftLabel}. Takes effect when it's published, or when the experiment starts.`
      : `From ${draftLabel}. Takes effect when it's published.`;

  // JSON is too big to edit in a cell, so it opens the values editor.
  const isJson = valueType === "json";
  const controls =
    editable && isJson ? (
      <Button
        variant="ghost"
        size="sm"
        icon={<PiPencilSimple />}
        onClick={() => setEditingValues(null)}
      >
        Edit values
      </Button>
    ) : null;

  const typeBlocked: Partial<Record<FeatureValueType, string>> =
    variations.length > 2 ? { boolean: "Needs exactly two variations" } : {};
  const valueTypeControl = editable ? (
    <DropdownMenu
      trigger={
        <Link color="dark">
          <Flex align="center" gap="1">
            <Text size="sm">{TYPE_NAMES[valueType]}</Text>
            <PiCaretDownFill size={10} />
          </Flex>
        </Link>
      }
      menuPlacement="end"
      variant="soft"
    >
      {VALUE_TYPE_ORDER.map((t) => (
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
            <span>{TYPE_NAMES[t]}</span>
          </Tooltip>
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  ) : (
    <Text size="sm">{TYPE_NAMES[valueType]}</Text>
  );

  return (
    <>
      {managed ? (
        // The list's gap already spaces it; pull the box up under it.
        <Flex align="center" justify="between" mt="2" mb="-2">
          <ImplementationHeading mt="0" mb="0">
            Values
          </ImplementationHeading>
          <Flex align="center" gap="4">
            {controls}
            <Flex align="center" gap="1">
              <Text size="sm" color="text-low">
                Type:
              </Text>
              {valueTypeControl}
            </Flex>
          </Flex>
        </Flex>
      ) : null}
      {/* As wide as the variation grid, with the same columns, and the inset
          on each cell rather than the box, so every field sits inside its card. */}
      {/* A managed flag has no header, so each value is its own card. */}
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
            close={() => setEditEnvironments(false)}
            mutate={mutate}
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
              {/* A new tab, so following it never costs the page's unsaved edits. */}
              <Link
                href={`/features/${feature.id}`}
                target="_blank"
                rel="noreferrer"
                weight="medium"
              >
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
              {controls}
              <Flex align="center" gap="1">
                {environmentStates.length ? (
                  <Popover
                    openOnHover
                    side="top"
                    align="end"
                    avoidCollisions={false}
                    trigger={
                      // The trigger takes the hover handlers, so it must be a plain element.
                      <span
                        style={{
                          cursor: "default",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "var(--space-1)",
                        }}
                      >
                        {environmentsChanged ? <UnpublishedDot /> : null}
                        <Text size="sm" color="text-low">
                          Environments {activeEnvironments.length}/
                          {environmentStates.length}
                        </Text>
                      </span>
                    }
                    content={
                      // The two settings get fixed columns so their marks line up.
                      <Grid
                        columns="max-content 40px 40px max-content"
                        gapX="4"
                        gapY="2"
                        align="center"
                      >
                        <Box />
                        <Flex justify="center">
                          <Text size="sm" color="text-low">
                            Flag
                          </Text>
                        </Flex>
                        <Flex justify="center">
                          <Text size="sm" color="text-low">
                            Rule
                          </Text>
                        </Flex>
                        <Box />
                        {environmentStates.map(({ env, state, isActive }) => {
                          const input = environmentInputs?.[env];
                          const changed = changedInputs(env);
                          // null: nothing known about this environment.
                          const setting = (
                            value: boolean | null,
                            moved: boolean,
                          ) => (
                            <Flex align="center" justify="center">
                              <Box
                                position="relative"
                                style={{ display: "flex" }}
                              >
                                {value === null ? (
                                  <Text size="sm" color="text-low">
                                    —
                                  </Text>
                                ) : (
                                  // Same marks as a feature rule's environment badges.
                                  <Box
                                    aria-label={value ? "On" : "Off"}
                                    style={{ display: "flex" }}
                                  >
                                    {value ? (
                                      <FaRegCircleCheck
                                        size={14}
                                        style={{ color: "var(--green-11)" }}
                                      />
                                    ) : (
                                      <FaRegCircleXmark
                                        size={14}
                                        style={{ color: "var(--gray-8)" }}
                                      />
                                    )}
                                  </Box>
                                )}
                                {/* Beside the mark, not in the flow, so the mark stays centered. */}
                                {moved ? (
                                  <Box
                                    position="absolute"
                                    style={{
                                      left: "100%",
                                      top: "50%",
                                      transform: "translateY(-50%)",
                                      marginLeft: 4,
                                    }}
                                  >
                                    <UnpublishedDot tooltip="Changed in the draft" />
                                  </Box>
                                ) : null}
                              </Box>
                            </Flex>
                          );
                          return (
                            <Fragment key={env}>
                              <span
                                style={{
                                  color: isActive ? undefined : "var(--gray-8)",
                                  fontWeight: isActive ? 500 : 300,
                                }}
                              >
                                {env}
                              </span>
                              {setting(
                                input ? input.flagEnabled : null,
                                changed.flag,
                              )}
                              {/* A rule that doesn't target the environment is off there too. */}
                              {setting(
                                input ? input.rule === "on" : null,
                                changed.rule,
                              )}
                              <Flex align="center" gap="1">
                                <Box
                                  style={{
                                    display: "flex",
                                    color: isActive
                                      ? "var(--green-11)"
                                      : "var(--slate-9)",
                                  }}
                                >
                                  {isActive ? (
                                    <FaCircleCheck size={14} />
                                  ) : (
                                    <FaCircleXmark size={14} />
                                  )}
                                </Box>
                                <Text size="sm" weight="medium">
                                  {ENVIRONMENT_STATE_LABELS[state] ?? state}
                                </Text>
                              </Flex>
                            </Fragment>
                          );
                        })}
                        {environmentsTiming ? (
                          <Box gridColumn="1 / -1" mt="1">
                            <Text size="sm" color="text-low">
                              {environmentsTiming}
                            </Text>
                          </Box>
                        ) : null}
                      </Grid>
                    }
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
                        target="_blank"
                        rel="noreferrer"
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
        <Grid columns={VARIATION_GRID_COLUMNS} gap="4">
          {variations.map((v) => {
            const value = valueFor(v.id);
            const block = isJson;
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
            // A string field has a label row above it; the dot goes on the
            // field itself, so the field places it.
            const fieldPlacesDot = editable && valueType === "string";
            return (
              <Flex
                key={v.id}
                align={block ? "start" : "center"}
                gap="2"
                px={managed ? "2" : "3"}
                py={managed ? "2" : "0"}
                minWidth="0"
                className={managed ? "appbox mb-0" : undefined}
              >
                {/* On a one-line field's centre line, whatever the type. */}
                <Box flexShrink="0" mt={block ? "2" : "0"}>
                  <VariationNumber number={v.index} />
                </Box>
                <Box
                  flexGrow="1"
                  minWidth="0"
                  position="relative"
                  className={styles.valueCell}
                >
                  {editable && !isJson ? (
                    <FeatureValueField
                      id={`flag-${feature.id}-${v.id}`}
                      value={value ?? ""}
                      setValue={(next) => stage({ values: { [v.id]: next } })}
                      valueType={valueType}
                      feature={displayFeature}
                      renderJSONInline
                      useDropdown
                      // Beside the field, so every type's cell is one line tall.
                      inlineConstantButton
                      inlineConstantButtonSize="1"
                      actionsOverlay={STRING_ACTIONS}
                      fieldOverlay={draftDot}
                      useCodeInput
                      showFullscreenButton
                      sparse={sparse}
                      allowConfigBacking={!!configKey}
                      configBackingOptionKeys={configBackingOptionKeys}
                      configBackingShowPatch={!!configKey}
                      lockConfigBacking={!!configKey}
                    />
                  ) : value === undefined && !isJson ? (
                    <HelperText status="warning">No value set</HelperText>
                  ) : (
                    <Box
                      className={
                        isJson
                          ? clsx(
                              styles.jsonValue,
                              value === undefined && styles.jsonEmpty,
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
                          sparse={sparse}
                          fontSize="0.7rem"
                          lineHeight={1.3}
                          actionsOverlay={JSON_ACTIONS}
                        />
                      )}
                      {editable && isJson ? (
                        <Tooltip content="Edit values">
                          <IconButton
                            className={styles.editValue}
                            variant="ghost"
                            color="violet"
                            radius="medium"
                            size="1"
                            onClick={() => setEditingValues(v.id)}
                            aria-label={`Edit ${v.name || `Variation ${v.index}`} value`}
                          >
                            <PiPencilSimple size="16" />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                    </Box>
                  )}
                  {fieldPlacesDot ? null : draftDot}
                </Box>
              </Flex>
            );
          })}
        </Grid>
      </Box>
    </>
  );
}
