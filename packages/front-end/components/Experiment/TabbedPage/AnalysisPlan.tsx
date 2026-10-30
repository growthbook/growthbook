import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import isEqual from "lodash/isEqual";
import { datasourceChangeDrops } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  ExperimentAnalysisSettingsDraft,
  experimentAnalysisSettingsDraft,
} from "shared/validators";
import { getScopedSettings } from "shared/settings";
import {
  hasPendingScheduledStart,
  isProjectListValidForProject,
  resolveAnalysisIdentifierType,
} from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import SelectField from "@/components/Forms/SelectField";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import {
  METRIC_ROWS,
  useMetricDisabledInfo,
} from "@/components/Experiment/ExperimentMetricsSelector";
import {
  getAutoDatasourceId,
  getAutoExposureQueryId,
} from "@/components/Experiment/SimpleNewExperimentForm";
import {
  followAssignmentAttribute,
  getExposureQueriesInScope,
  getHashAttributeIdentifierTypeMap,
  resolveAssignmentIdentifier,
} from "@/services/datasources";
import { useTargetingDefaults } from "@/components/Experiment/useExperimentTargetingForm";
import type { AnalysisFormFocus } from "@/components/Experiment/AnalysisForm";
import MetricOverridesModal from "@/components/Experiment/MetricOverridesModal";
import AssignmentQueryFields, {
  useAssignmentQuerySelection,
} from "@/components/Experiment/AssignmentQueryFields";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import {
  useExperimentFieldEdit,
  useHoldEditBases,
  useStagedState,
} from "./ExperimentEdits";
import SetupFieldRow from "./SetupFieldRow";
import { RestrictedValue } from "./ProjectTagBar";
import { useDecisionFrameworkApplies } from "./DecisionMakingSettings";
import AnalysisPlanAdvanced from "./AnalysisPlanAdvanced";
import DecisionPlan from "./DecisionPlan";
import { QuickEditRow } from "./QuickEditButton";
import type { TargetingDraft } from "./TrafficAllocationFunnel";

type MetricField = "goalMetrics" | "secondaryMetrics" | "guardrailMetrics";
type PlanField =
  | "datasource"
  | "exposureQueryId"
  | "exposureQueryIdentifierType"
  | MetricField;

type AssignmentSelection = {
  datasource: string;
  exposureQueryId: string;
  // "" leaves it to the query's first declared identifier.
  identifierType: string;
};

export const DATASOURCE_CHANGE_NOTE =
  "Metrics and segments that aren't from the new Data Source are removed.";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  datasourceMissing?: boolean;
  canEdit: boolean;
  // The start checklist points at a field here; no field means the advanced
  // settings.
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  settingsFocus?: AnalysisFormFocus | null;
  // Holds the assignment attribute until the page saves.
  targetingDraft?: TargetingDraft;
  canEditTargeting?: boolean;
  canEditSchedule: boolean;
  mutate: () => void;
  envs: string[];
}

export default function AnalysisPlan({
  experiment,
  datasourceMissing = false,
  canEdit,
  settingsOpen,
  setSettingsOpen,
  settingsFocus = null,
  targetingDraft,
  canEditTargeting = false,
  canEditSchedule,
  mutate,
  envs,
}: Props) {
  const {
    datasources,
    getDatasourceById,
    getExperimentMetricById,
    getMetricGroupById,
    getSegmentById,
    getProjectById,
  } = useDefinitions();
  const { organization } = useUser();
  const { defaultDataSource } = useOrgSettings();
  const { demoDataSourceId } = useDemoDataSourceProject();
  const targetingDefaults = useTargetingDefaults(experiment);

  const hashAttribute =
    targetingDraft?.value?.hashAttribute || experiment.hashAttribute || "id";
  // Before it runs, the analysis and the assignment attribute follow each
  // other; after, a new attribute would re-randomize.
  const bound =
    canEdit &&
    experiment.status === "draft" &&
    !hasPendingScheduledStart(experiment);
  const stageHashAttribute =
    bound && canEditTargeting && targetingDraft
      ? (attribute: string) =>
          targetingDraft.set((prev) => ({
            ...(prev ?? targetingDefaults),
            hashAttribute: attribute,
          }))
      : null;

  // Settings beyond the fields held in their own state below.
  const [advanced, setAdvanced] =
    useStagedState<ExperimentAnalysisSettingsDraft | null>(
      "analysis-plan:advanced",
      null,
    );
  // A setting put back to what's saved is no longer an edit.
  const stage = useCallback(
    (changes: ExperimentAnalysisSettingsDraft) =>
      setAdvanced((prev) => {
        const next: Record<string, unknown> = { ...prev, ...changes };
        Object.keys(next).forEach((key) => {
          const saved = (experiment as Record<string, unknown>)[key];
          if (isEqual(next[key] ?? null, saved ?? null)) delete next[key];
        });
        return Object.keys(next).length ? next : null;
      }),
    [setAdvanced, experiment],
  );
  // Open when it filters who's counted, so that isn't hidden.
  const [advancedOpen, setAdvancedOpen] = useState(
    !!experiment.activationMetric || !!experiment.segment,
  );

  const effective = useMemo(
    () => ({ ...experiment, ...advanced }),
    [experiment, advanced],
  );
  const metricOverrides = effective.metricOverrides ?? [];
  const decisionFrameworkSettings = effective.decisionFrameworkSettings;
  const targetMDEOverrides = useDecisionFrameworkApplies(experiment)
    ? (decisionFrameworkSettings?.decisionFrameworkMetricOverrides ?? [])
    : undefined;
  const statsEngine = getScopedSettings({
    organization,
    project: getProjectById(experiment.project || "") ?? undefined,
    experiment: effective,
  }).settings.statsEngine.value;
  const settingsScope = useMemo(
    () => ({ experiment: effective, statsEngine }),
    [effective, statsEngine],
  );
  const [overridesFor, setOverridesFor] = useState<string[] | null>(null);

  const suggestedDatasource = useMemo(
    () =>
      getAutoDatasourceId({
        datasources,
        demoDataSourceId,
        defaultDataSource,
        project: experiment.project || "",
      }),
    [datasources, demoDataSourceId, defaultDataSource, experiment.project],
  );

  const [datasource, setDatasource] = useStagedState(
    "analysis-plan:datasource",
    experiment.datasource || suggestedDatasource,
  );
  const [exposureQueryId, setExposureQueryId] = useStagedState(
    "analysis-plan:exposureQueryId",
    experiment.exposureQueryId || "",
  );
  const [identifierType, setIdentifierType] = useStagedState(
    "analysis-plan:exposureQueryIdentifierType",
    experiment.exposureQueryIdentifierType || "",
  );
  const [goalMetrics, setGoalMetrics] = useStagedState(
    "analysis-plan:goalMetrics",
    experiment.goalMetrics || [],
  );
  const [secondaryMetrics, setSecondaryMetrics] = useStagedState(
    "analysis-plan:secondaryMetrics",
    experiment.secondaryMetrics || [],
  );
  const [guardrailMetrics, setGuardrailMetrics] = useStagedState(
    "analysis-plan:guardrailMetrics",
    experiment.guardrailMetrics || [],
  );
  // Only touched fields are sent, so this section's copy can't revert a write
  // from elsewhere, and a suggested datasource doesn't raise the save bar.
  const [touchedFields, setTouchedFields] = useStagedState<PlanField[]>(
    "analysis-plan:touched",
    [],
  );
  const touched: ReadonlySet<PlanField> = useMemo(
    () => new Set(touchedFields),
    [touchedFields],
  );
  const touch = useCallback(
    (...fields: PlanField[]) =>
      setTouchedFields((prev) => [...new Set([...prev, ...fields])]),
    [setTouchedFields],
  );
  // What belongs to the old source goes with it.
  const changeDatasource = (id: string) => {
    if (id === datasource) return;
    touch("datasource", "exposureQueryId", "exposureQueryIdentifierType");
    setDatasource(id);
    setExposureQueryId("");
    setIdentifierType("");
    // Cleared, the rest stays for switching back.
    if (!id) return;
    const {
      goalMetrics: keptGoals,
      secondaryMetrics: keptSecondaries,
      guardrailMetrics: keptGuardrails,
      ...advancedDrops
    } = datasourceChangeDrops(
      { ...effective, goalMetrics, secondaryMetrics, guardrailMetrics },
      {
        metricFromSource: (metricId) =>
          (getExperimentMetricById(metricId) ?? getMetricGroupById(metricId))
            ?.datasource === id,
        segmentFromSource: (segmentId) =>
          getSegmentById(segmentId)?.datasource === id,
      },
    );
    (
      [
        ["goalMetrics", keptGoals, setGoalMetrics],
        ["secondaryMetrics", keptSecondaries, setSecondaryMetrics],
        ["guardrailMetrics", keptGuardrails, setGuardrailMetrics],
      ] as const
    ).forEach(([field, kept, set]) => {
      if (!kept) return;
      touch(field);
      set(kept);
    });
    stage(advancedDrops);
  };
  const changeSelection = (next: AssignmentSelection) => {
    touch("datasource", "exposureQueryId", "exposureQueryIdentifierType");
    changeDatasource(next.datasource);
    setExposureQueryId(next.exposureQueryId);
    setIdentifierType(next.identifierType);
    // A table or identifier picked by hand brings its assignment attribute.
    const { attribute } = resolveSelection(
      getDatasourceById(next.datasource),
      next.exposureQueryId,
      next.identifierType,
      hashAttribute,
    );
    if (attribute) stageHashAttribute?.(attribute);
  };
  const current = {
    datasource,
    exposureQueryId,
    exposureQueryIdentifierType: identifierType,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
  };
  const stored = (field: PlanField) =>
    experiment[field] ?? (field.endsWith("Metrics") ? [] : "");
  const edited = [...touched].filter(
    (field) => !isEqual(current[field], stored(field)),
  );
  const dirty = advanced !== null || edited.length > 0;
  // Values the page filled in where the experiment has none show as chosen, so
  // they go with any edit.
  const sent = dirty
    ? [
        ...new Set([
          ...edited,
          ...(
            [
              "datasource",
              "exposureQueryId",
              "exposureQueryIdentifierType",
            ] as const
          ).filter((field) => !experiment[field] && !!current[field]),
        ]),
      ]
    : [];

  // Fields left alone follow the experiment as other surfaces write it.
  const touchedRef = useRef(touched);
  touchedRef.current = touched;
  const resync = useCallback(
    (except: ReadonlySet<PlanField>, keepFilled = true) => {
      if (!except.has("datasource")) {
        setDatasource(experiment.datasource || suggestedDatasource);
      }
      // A query the page filled in where the experiment has none stays.
      const keep = keepFilled && !experiment.exposureQueryId;
      if (!except.has("exposureQueryId")) {
        setExposureQueryId(
          (prev) => experiment.exposureQueryId || (keep ? prev : ""),
        );
      }
      if (!except.has("exposureQueryIdentifierType")) {
        setIdentifierType(
          (prev) =>
            experiment.exposureQueryIdentifierType || (keep ? prev : ""),
        );
      }
      if (!except.has("goalMetrics")) {
        setGoalMetrics(experiment.goalMetrics || []);
      }
      if (!except.has("secondaryMetrics")) {
        setSecondaryMetrics(experiment.secondaryMetrics || []);
      }
      if (!except.has("guardrailMetrics")) {
        setGuardrailMetrics(experiment.guardrailMetrics || []);
      }
    },
    [
      experiment.datasource,
      experiment.exposureQueryId,
      experiment.exposureQueryIdentifierType,
      experiment.goalMetrics,
      experiment.secondaryMetrics,
      experiment.guardrailMetrics,
      suggestedDatasource,
      setDatasource,
      setExposureQueryId,
      setIdentifierType,
      setGoalMetrics,
      setSecondaryMetrics,
      setGuardrailMetrics,
    ],
  );
  useEffect(() => resync(touchedRef.current), [resync]);

  useExperimentFieldEdit("analysis-plan", dirty, experiment, {
    label: "Analysis plan",
    fields: () => ({
      ...advanced,
      ...Object.fromEntries(
        sent.map((field) => [
          field,
          // Unset, the server takes the query's first identifier.
          field === "exposureQueryIdentifierType"
            ? current[field] || undefined
            : current[field],
        ]),
      ),
    }),
    onSaved: () => {
      setTouchedFields([]);
      setAdvanced(null);
    },
    discard: () => {
      setAdvanced(null);
      setTouchedFields([]);
      resync(new Set(), false);
    },
  });

  const selectedDatasource = getDatasourceById(datasource);
  const deletedDatasource =
    datasourceMissing && datasource === experiment.datasource;
  // Set, but in a project the viewer can't see; so is its assignment query.
  const hiddenDatasource =
    !!datasource && !selectedDatasource && !deletedDatasource;
  const hashAttributeIdentifierTypeMap = useMemo(
    () =>
      getHashAttributeIdentifierTypeMap(
        selectedDatasource?.settings?.userIdTypes,
      ),
    [selectedDatasource?.settings?.userIdTypes],
  );
  const resolution = resolveSelection(
    selectedDatasource,
    exposureQueryId,
    identifierType,
    hashAttribute,
  );
  const scopedQueries = useMemo(
    () =>
      selectedDatasource
        ? getExposureQueriesInScope(selectedDatasource, experiment.project)
        : [],
    [selectedDatasource, experiment.project],
  );
  const followed = useMemo(
    () =>
      followAssignmentAttribute({
        queries: scopedQueries,
        hashAttribute,
        hashAttributeIdentifierTypeMap,
        exposureQueryId,
        identifierType,
      }),
    [
      scopedQueries,
      hashAttribute,
      hashAttributeIdentifierTypeMap,
      exposureQueryId,
      identifierType,
    ],
  );
  // Before it runs, an empty selection fills in and a new assignment attribute
  // brings its table and identifier; otherwise a conflict is only flagged.
  const followedFor = useRef<{
    datasource: string;
    hashAttribute: string;
  } | null>(null);
  useEffect(() => {
    if (!bound || !selectedDatasource) return;
    const prev = followedFor.current;
    if (
      prev?.datasource === datasource &&
      prev.hashAttribute === hashAttribute
    ) {
      return;
    }
    followedFor.current = { datasource, hashAttribute };
    const attributeChanged = !!prev && prev.hashAttribute !== hashAttribute;
    if (exposureQueryId && !attributeChanged) return;
    const next =
      followed ??
      (exposureQueryId
        ? null
        : {
            exposureQueryId: getAutoExposureQueryId({
              datasource: selectedDatasource,
              hashAttribute,
              project: experiment.project,
            }),
            identifierType: "",
          });
    if (!next?.exposureQueryId) return;
    setExposureQueryId(next.exposureQueryId);
    setIdentifierType(next.identifierType);
    // An empty field filling itself in is a default; replacing a saved query
    // is a change, and the save bar has to say so.
    if (experiment.exposureQueryId) {
      touch("exposureQueryId", "exposureQueryIdentifierType");
    }
  }, [
    bound,
    selectedDatasource,
    datasource,
    hashAttribute,
    exposureQueryId,
    followed,
    experiment.exposureQueryId,
    experiment.project,
    setExposureQueryId,
    setIdentifierType,
    touch,
  ]);

  const { activationMetric } = effective;
  const datasourceOptions = datasources
    .filter(
      (d) =>
        d.id === datasource ||
        (d.id !== demoDataSourceId &&
          isProjectListValidForProject(d.projects, experiment.project)),
    )
    .map((d) => ({ value: d.id, label: d.name }));

  const [editingDatasource, setEditingDatasource] = useState(false);
  useHoldEditBases(overridesFor !== null || editingDatasource);
  const editDatasource =
    canEdit && !hiddenDatasource ? () => setEditingDatasource(true) : null;

  // Pointed at from elsewhere: bring the field into view, or open the place
  // it's edited.
  useEffect(() => {
    if (!settingsOpen) return;
    setSettingsOpen(false);
    if (!settingsFocus) setAdvancedOpen(true);
    const inModal =
      settingsFocus === "datasource" || settingsFocus === "exposureQuery";
    if (inModal && canEdit) setEditingDatasource(true);
    const id = inModal
      ? "analysis-plan-datasource"
      : settingsFocus
        ? `analysis-plan-${settingsFocus}`
        : "analysis-plan-advanced";
    requestAnimationFrame(() => {
      const row = document.getElementById(id);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      row?.querySelector("input")?.focus({ preventScroll: true });
    });
  }, [settingsOpen, settingsFocus, setSettingsOpen, canEdit]);

  // Metrics an experiment can't use show disabled, with the reason.
  const getMetricDisabledInfo = useMetricDisabledInfo(
    datasource,
    experiment.id,
    experiment.type,
  );
  const metricRow = (
    field: MetricField,
    selected: string[],
    onChange: (ids: string[]) => void,
  ) => (
    <SetupFieldRow
      id={`analysis-plan-${field}`}
      label={METRIC_ROWS[field].label}
      tooltip={METRIC_ROWS[field].tooltip}
    >
      <MetricsSelector
        selected={selected}
        onChange={(ids) => {
          touch(field);
          onChange(ids);
        }}
        datasource={datasource}
        requireDatasource
        exposureQueryId={exposureQueryId}
        exposureQueryIdentifierType={identifierType || undefined}
        project={experiment.project}
        includeFacts
        includeGroups
        getMetricDisabledInfo={getMetricDisabledInfo}
        metricOverrides={metricOverrides}
        targetMDEOverrides={
          field === "goalMetrics" ? targetMDEOverrides : undefined
        }
        onManageOverrides={canEdit ? setOverridesFor : undefined}
        settingsScope={settingsScope}
        disabled={!canEdit}
      />
    </SetupFieldRow>
  );

  return (
    <>
      {overridesFor ? (
        <MetricOverridesModal
          experiment={experiment}
          datasource={datasource}
          statsEngine={statsEngine}
          metrics={{
            goalMetrics,
            secondaryMetrics,
            guardrailMetrics,
            activationMetric: activationMetric || "",
          }}
          // A single metric without an override yet opens ready to add one.
          overrides={
            overridesFor.length === 1 &&
            !metricOverrides.some((o) => o.id === overridesFor[0])
              ? [...metricOverrides, { id: overridesFor[0] }]
              : metricOverrides
          }
          focusMetricIds={overridesFor}
          targetMDEOverrides={targetMDEOverrides}
          close={() => setOverridesFor(null)}
          stageChanges={(next, nextTargetMDEs) => {
            // The same bounds the full settings modal stages through.
            const parsed = experimentAnalysisSettingsDraft.parse({
              metricOverrides: next,
              ...(nextTargetMDEs
                ? {
                    decisionFrameworkSettings: {
                      ...decisionFrameworkSettings,
                      decisionFrameworkMetricOverrides: nextTargetMDEs,
                    },
                  }
                : {}),
            });
            stage(parsed);
            setOverridesFor(null);
          }}
        />
      ) : null}
      {editingDatasource ? (
        <DataSourceModal
          experiment={experiment}
          hashAttribute={hashAttribute}
          stagesAttribute={!!stageHashAttribute}
          value={{ datasource, exposureQueryId, identifierType }}
          suggested={!experiment.datasource}
          options={datasourceOptions}
          close={() => setEditingDatasource(false)}
          change={changeSelection}
        />
      ) : null}
      <Separator size="4" my="2" />
      <Box py="4">
        <Heading color="text-high" as="h4" size="sm" mb="1">
          Analysis Plan
        </Heading>

        {/* The assignment query reads back in the details panel. */}
        <SetupFieldRow
          id="analysis-plan-datasource"
          label="Data Source"
          content="text"
        >
          <QuickEditRow label="Edit Data Source" onEdit={editDatasource}>
            <Text color="text-high">
              {hiddenDatasource ? (
                <RestrictedValue />
              ) : (
                (selectedDatasource?.name ??
                (deletedDatasource ? <em>Deleted</em> : <em>None</em>))
              )}
            </Text>
          </QuickEditRow>
          {resolution.conflict && resolution.identifierType ? (
            <AttributeConflict
              hashAttribute={hashAttribute}
              identifierType={resolution.identifierType}
            >
              {canEdit && followed ? (
                <Link
                  onClick={() => changeSelection({ datasource, ...followed })}
                >
                  Analyze per {followed.identifierType}
                </Link>
              ) : null}
              {stageHashAttribute && resolution.attribute ? (
                <Link
                  onClick={() =>
                    resolution.attribute &&
                    stageHashAttribute(resolution.attribute)
                  }
                >
                  Assign by {resolution.attribute}
                </Link>
              ) : null}
              {editDatasource ? (
                <Link onClick={editDatasource}>Choose another</Link>
              ) : null}
            </AttributeConflict>
          ) : resolution.choose &&
            resolution.identifierType !== identifierType ? (
            // Left unset, the table's first identifier is the one analyzed.
            <HelperText status="info" size="sm" mt="1">
              <span>
                The assignment query has several identifier types, and the
                assignment attribute doesn&apos;t settle which.{" "}
                {editDatasource ? (
                  <Link onClick={editDatasource}>Choose one</Link>
                ) : null}
              </span>
            </HelperText>
          ) : null}
        </SetupFieldRow>

        {metricRow("goalMetrics", goalMetrics, setGoalMetrics)}
        {metricRow("secondaryMetrics", secondaryMetrics, setSecondaryMetrics)}
        {metricRow("guardrailMetrics", guardrailMetrics, setGuardrailMetrics)}

        <DecisionPlan
          experiment={effective}
          stage={stage}
          canEdit={canEdit}
          canEditSchedule={canEditSchedule}
          mutate={mutate}
          envs={envs}
        />

        <AnalysisPlanAdvanced
          open={advancedOpen}
          setOpen={setAdvancedOpen}
          experiment={effective}
          datasourceId={datasource}
          exposureQueryId={exposureQueryId}
          identifierType={resolution.identifierType}
          metrics={{ goalMetrics, secondaryMetrics, guardrailMetrics }}
          stage={stage}
          manageOverrides={
            canEdit
              ? () =>
                  setOverridesFor([
                    ...goalMetrics,
                    ...secondaryMetrics,
                    ...guardrailMetrics,
                  ])
              : undefined
          }
          canEdit={canEdit}
        />
      </Box>
    </>
  );
}

function DataSourceModal({
  experiment,
  hashAttribute,
  stagesAttribute,
  value,
  suggested,
  options,
  close,
  change,
}: {
  experiment: ExperimentInterfaceStringDates;
  hashAttribute: string;
  // Confirming also stages the attribute the chosen identifier leads to.
  stagesAttribute: boolean;
  value: AssignmentSelection;
  // Filled in by the page rather than saved, so confirming it is a change.
  suggested: boolean;
  options: { value: string; label: string }[];
  close: () => void;
  change: (next: AssignmentSelection) => void;
}) {
  const { getDatasourceById } = useDefinitions();
  // An experiment saved before identifiers were stored shows the one it uses.
  const storedQuery = getDatasourceById(
    value.datasource,
  )?.settings?.queries?.exposure?.find((q) => q.id === value.exposureQueryId);
  const initialIdentifier =
    value.identifierType ||
    (storedQuery ? resolveAnalysisIdentifierType(storedQuery, undefined) : "");
  const [datasource, setDatasource] = useState(value.datasource);
  const [exposureQueryId, setExposureQueryId] = useState(value.exposureQueryId);
  const [identifierType, setIdentifierType] = useState<string | undefined>(
    initialIdentifier || undefined,
  );
  const selected = getDatasourceById(datasource);
  const sameSource = datasource === value.datasource;
  const selection = useAssignmentQuerySelection({
    datasource: selected,
    project: experiment.project,
    hashAttribute,
    exposureQueryId,
    identifierType,
    setExposureQueryId,
    setIdentifierType,
    // A new source starts from its defaults; the saved one shows as it is.
    autoRepair: !sameSource,
    keepCurrentSelection: sameSource,
  });
  const resolution = resolveSelection(
    selected,
    exposureQueryId,
    identifierType,
    hashAttribute,
  );
  const changed =
    suggested ||
    !sameSource ||
    exposureQueryId !== value.exposureQueryId ||
    (identifierType ?? "") !== initialIdentifier;
  return (
    <ModalStandard
      open
      header="Data Source"
      close={close}
      cta="Confirm"
      ctaEnabled={changed}
      trackingEventModalType="experiment-data-source"
      submit={() => {
        change({
          datasource,
          exposureQueryId,
          identifierType: identifierType ?? "",
        });
        close();
      }}
    >
      <SelectField
        label="Data Source"
        labelClassName="font-weight-bold"
        value={datasource}
        onChange={setDatasource}
        initialOption="None"
        options={options}
        helpText={
          !sameSource && value.datasource ? DATASOURCE_CHANGE_NOTE : undefined
        }
      />
      {selected?.properties?.exposureQueries ? (
        <AssignmentQueryFields
          selection={selection}
          placeholder="Choose..."
          progressive
        />
      ) : null}
      {stagesAttribute && resolution.attribute ? (
        <HelperText status="info" size="sm">
          The assignment attribute changes to{" "}
          <code>{resolution.attribute}</code> to match.
        </HelperText>
      ) : resolution.conflict && resolution.identifierType ? (
        <AttributeConflict
          hashAttribute={hashAttribute}
          identifierType={resolution.identifierType}
        />
      ) : null}
    </ModalStandard>
  );
}

function resolveSelection(
  datasource: DataSourceInterfaceWithParams | null,
  exposureQueryId: string,
  identifierType: string | undefined,
  hashAttribute: string,
) {
  const settings = datasource?.settings;
  return resolveAssignmentIdentifier({
    query: settings?.queries?.exposure?.find((q) => q.id === exposureQueryId),
    identifierType,
    hashAttribute,
    hashAttributeIdentifierTypeMap: getHashAttributeIdentifierTypeMap(
      settings?.userIdTypes,
    ),
  });
}

function AttributeConflict({
  hashAttribute,
  identifierType,
  children,
}: {
  hashAttribute: string;
  identifierType: string;
  // Ways out, where there are any.
  children?: ReactNode;
}) {
  return (
    <HelperText status="warning" size="sm" mt="1">
      <span>
        This experiment assigns by <code>{hashAttribute}</code> but is analyzed
        per <code>{identifierType}</code>, which the assignment attribute
        isn&apos;t linked to.{" "}
        <Flex as="span" gap="3" display="inline-flex">
          {children}
        </Flex>
      </span>
    </HelperText>
  );
}
