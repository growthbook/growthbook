import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiLockSimple } from "react-icons/pi";
import isEqual from "lodash/isEqual";
import { getMetricLink } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  ExperimentAnalysisSettingsDraft,
  experimentAnalysisSettingsDraft,
} from "shared/validators";
import { getScopedSettings } from "shared/settings";
import {
  getExposureQueryIdentifierTypes,
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
  getAutoDatasourceId,
  getAutoExposureQueryId,
} from "@/components/Experiment/SimpleNewExperimentForm";
import { getExposureQueriesForAttribute } from "@/services/datasources";
import type { AnalysisFormFocus } from "@/components/Experiment/AnalysisForm";
import MetricOverridesModal from "@/components/Experiment/MetricOverridesModal";
import AssignmentQueryFields, {
  useAssignmentQuerySelection,
} from "@/components/Experiment/AssignmentQueryFields";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { useExperimentFieldEdit, useStagedState } from "./ExperimentEdits";
import SetupFieldRow from "./SetupFieldRow";
import { useDecisionFrameworkApplies } from "./DecisionMakingSettings";
import AnalysisPlanAdvanced from "./AnalysisPlanAdvanced";

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

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  canEdit: boolean;
  // Other parts of the page point at a field here: the checklist, and the
  // details panel's data source. No field means the advanced settings.
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  settingsFocus?: AnalysisFormFocus | null;
}

export default function AnalysisPlan({
  experiment,
  canEdit,
  settingsOpen,
  setSettingsOpen,
  settingsFocus = null,
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
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
  // As the settings modal did: what belongs to the old source goes with it.
  const changeDatasource = (id: string) => {
    if (id === datasource) return;
    touch("datasource", "exposureQueryId", "exposureQueryIdentifierType");
    setDatasource(id);
    setExposureQueryId("");
    setIdentifierType("");
    // Cleared, the rest stays for switching back.
    if (!id) return;
    const fromSource = (metricId: string) =>
      (getExperimentMetricById(metricId) ?? getMetricGroupById(metricId))
        ?.datasource === id;
    (
      [
        ["goalMetrics", goalMetrics, setGoalMetrics],
        ["secondaryMetrics", secondaryMetrics, setSecondaryMetrics],
        ["guardrailMetrics", guardrailMetrics, setGuardrailMetrics],
      ] as const
    ).forEach(([field, ids, set]) => {
      const kept = ids.filter(fromSource);
      if (kept.length === ids.length) return;
      touch(field);
      set(kept);
    });
    const { segment, activationMetric, precomputedUnitDimensionIds } =
      effective;
    stage({
      ...(segment && getSegmentById(segment)?.datasource !== id
        ? { segment: "" }
        : {}),
      ...(activationMetric && !fromSource(activationMetric)
        ? { activationMetric: "" }
        : {}),
      ...(precomputedUnitDimensionIds?.length
        ? { precomputedUnitDimensionIds: [] }
        : {}),
    });
  };
  const changeSelection = (next: AssignmentSelection) => {
    changeDatasource(next.datasource);
    touch("exposureQueryId", "exposureQueryIdentifierType");
    setExposureQueryId(next.exposureQueryId);
    setIdentifierType(next.identifierType);
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
          ...(["datasource", "exposureQueryId"] as const).filter(
            (field) => !experiment[field] && !!current[field],
          ),
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
      if (!except.has("exposureQueryId")) {
        setExposureQueryId(
          (prev) => experiment.exposureQueryId || (keepFilled ? prev : ""),
        );
      }
      if (!except.has("exposureQueryIdentifierType")) {
        setIdentifierType(experiment.exposureQueryIdentifierType || "");
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
  // Set, but in a project the viewer can't see; so is its assignment query.
  const hiddenDatasource = !!datasource && !selectedDatasource;
  const restricted = (
    <Tooltip content="This data source is in a project you don't have access to.">
      <Flex as="span" align="center" gap="1" style={{ display: "inline-flex" }}>
        <PiLockSimple />
        <em>Restricted</em>
      </Flex>
    </Tooltip>
  );
  const exposureQueries = selectedDatasource?.settings?.queries?.exposure ?? [];
  const exposureQuery = exposureQueries.find((q) => q.id === exposureQueryId);

  const hashAttribute = experiment.hashAttribute || "";
  const { matching, other, linked } = useMemo(
    () =>
      getExposureQueriesForAttribute(
        selectedDatasource?.settings,
        hashAttribute,
      ),
    [selectedDatasource?.settings, hashAttribute],
  );
  const queryOption = (q: { id: string; name: string }) => ({
    value: q.id,
    label: q.name,
  });
  const mismatched =
    linked &&
    !!exposureQueryId &&
    !matching.some((q) => q.id === exposureQueryId);

  // Before it runs, follow the assignment attribute to the one query it names,
  // unless a deliberate choice still works.
  const autoAppliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!canEdit || experiment.status !== "draft" || !selectedDatasource) {
      return;
    }
    const key = `${datasource}:${hashAttribute}`;
    if (autoAppliedFor.current === key) return;
    autoAppliedFor.current = key;
    if (exposureQueryId && !mismatched) return;
    const suggestion = getAutoExposureQueryId({
      datasource: selectedDatasource,
      hashAttribute,
    });
    if (!suggestion || suggestion === exposureQueryId) return;
    setExposureQueryId(suggestion);
    // An empty field filling itself in is a default; replacing a saved query
    // is a change, and the save bar has to say so.
    if (experiment.exposureQueryId) touch("exposureQueryId");
  }, [
    canEdit,
    selectedDatasource,
    datasource,
    hashAttribute,
    exposureQueryId,
    mismatched,
    experiment.exposureQueryId,
    experiment.status,
    setExposureQueryId,
    touch,
  ]);

  const { activationMetric, segment } = effective;
  const datasourceOptions = datasources
    .filter(
      (d) =>
        d.id === datasource ||
        (d.id !== demoDataSourceId &&
          isProjectListValidForProject(d.projects, experiment.project)),
    )
    .map((d) => ({ value: d.id, label: d.name }));

  // Pointed at from elsewhere: bring the field into view, or open the place
  // it's edited.
  // A saved data source is edited in the modal, which stays open until closed.
  const editingDatasource =
    settingsOpen && settingsFocus === "datasource" && !!experiment.datasource;
  useEffect(() => {
    if (!settingsOpen || editingDatasource) return;
    setSettingsOpen(false);
    if (!settingsFocus) setAdvancedOpen(true);
    const id = settingsFocus
      ? `analysis-plan-${settingsFocus}`
      : "analysis-plan-advanced";
    requestAnimationFrame(() => {
      const row = document.getElementById(id);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      row?.querySelector("input")?.focus({ preventScroll: true });
    });
  }, [settingsOpen, settingsFocus, setSettingsOpen, editingDatasource]);

  const metricRow = (
    label: string,
    tooltip: string,
    field: MetricField,
    selected: string[],
    onChange: (ids: string[]) => void,
  ) => (
    <SetupFieldRow
      id={`analysis-plan-${field}`}
      label={label}
      tooltip={tooltip}
    >
      <MetricsSelector
        selected={selected}
        onChange={(ids) => {
          touch(field);
          onChange(ids);
        }}
        datasource={datasource}
        exposureQueryId={exposureQueryId}
        project={experiment.project}
        includeFacts
        includeGroups
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
          value={{ datasource, exposureQueryId, identifierType }}
          options={datasourceOptions}
          close={() => setSettingsOpen(false)}
          change={changeSelection}
        />
      ) : null}
      <Separator size="4" my="2" />
      <Box py="4">
        <Heading color="text-high" as="h4" size="sm" mb="1">
          Analysis Plan
        </Heading>

        {/* Once saved, the data source changes from the details panel. */}
        {!experiment.datasource ? (
          <SetupFieldRow
            id="analysis-plan-datasource"
            label="Data Source"
            tooltip="Where this experiment's exposures and metrics are queried."
          >
            <SelectField
              value={datasource}
              onChange={changeDatasource}
              initialOption="None"
              options={datasourceOptions}
              placeholder="Select data source..."
              forceUndefinedValueToNull
              disabled={!canEdit}
            />
          </SetupFieldRow>
        ) : null}

        <SetupFieldRow
          id="analysis-plan-exposureQuery"
          label="Assignment Query"
          tooltip="Defines who is in the experiment and how they are identified."
          content={hiddenDatasource ? "text" : undefined}
        >
          {hiddenDatasource ? (
            <Text color="text-high">
              {exposureQueryId ? restricted : <em>None</em>}
            </Text>
          ) : (
            <SelectField
              value={exposureQueryId}
              onChange={(value) => {
                touch("exposureQueryId");
                setExposureQueryId(value);
                // An identifier the new query doesn't declare can't come along.
                const query = exposureQueries.find((q) => q.id === value);
                if (
                  identifierType &&
                  query &&
                  !getExposureQueryIdentifierTypes(query).includes(
                    identifierType,
                  )
                ) {
                  touch("exposureQueryIdentifierType");
                  setIdentifierType("");
                }
              }}
              required
              sort={false}
              // Without this a discard leaves the old name in the closed
              // control: react-select goes uncontrolled on an undefined value.
              forceUndefinedValueToNull
              placeholder="Select assignment query..."
              options={
                linked && matching.length > 0
                  ? [
                      {
                        label: `Keyed to ${hashAttribute}`,
                        options: matching.map(queryOption),
                      },
                      ...(other.length > 0
                        ? [
                            {
                              label: "Other assignment queries",
                              options: other.map(queryOption),
                            },
                          ]
                        : []),
                    ]
                  : exposureQueries.map(queryOption)
              }
              formatOptionLabel={({ label, value }) => {
                const userIdType = exposureQueries.find(
                  (e) => e.id === value,
                )?.userIdType;
                return (
                  <>
                    {label}
                    {userIdType ? (
                      <span
                        className="text-muted small float-right position-relative"
                        style={{ top: 3 }}
                      >
                        Identifier Type: <code>{userIdType}</code>
                      </span>
                    ) : null}
                  </>
                );
              }}
              disabled={!canEdit || !selectedDatasource}
            />
          )}
          {mismatched ? (
            <HelperText status="warning" size="sm" mt="1">
              This experiment buckets on <code>{hashAttribute}</code>, which is
              not linked to this query&apos;s identifier type
              {exposureQuery?.userIdType ? (
                <>
                  {" "}
                  (<code>{exposureQuery.userIdType}</code>)
                </>
              ) : null}
              .
            </HelperText>
          ) : null}
        </SetupFieldRow>

        {activationMetric ? (
          <SetupFieldRow
            label="Activation metric"
            tooltip="Only users who convert on this metric are included in the analysis."
            content="text"
          >
            <Link href={getMetricLink(activationMetric)}>
              {getExperimentMetricById(activationMetric)?.name ||
                activationMetric}
            </Link>
          </SetupFieldRow>
        ) : null}

        {segment ? (
          <SetupFieldRow
            label="Segment"
            tooltip="Limits the analysis to users in this segment."
            content="text"
          >
            <Text color="text-high">
              {getSegmentById(segment)?.name || segment}
            </Text>
          </SetupFieldRow>
        ) : null}

        {metricRow(
          "Goal metrics",
          "What this experiment is trying to improve.",
          "goalMetrics",
          goalMetrics,
          setGoalMetrics,
        )}
        {metricRow(
          "Secondary metrics",
          "Extra metrics to learn from, but not the objective.",
          "secondaryMetrics",
          secondaryMetrics,
          setSecondaryMetrics,
        )}
        {metricRow(
          "Guardrail metrics",
          "Metrics to watch for harm, not to improve.",
          "guardrailMetrics",
          guardrailMetrics,
          setGuardrailMetrics,
        )}

        <AnalysisPlanAdvanced
          open={advancedOpen}
          setOpen={setAdvancedOpen}
          experiment={effective}
          savedStatsEngine={experiment.statsEngine}
          datasourceId={datasource}
          exposureQueryId={exposureQueryId}
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

// The data source, then once there's one, what the experiment is analyzed on
// in it.
function DataSourceModal({
  experiment,
  value,
  options,
  close,
  change,
}: {
  experiment: ExperimentInterfaceStringDates;
  value: AssignmentSelection;
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
    hashAttribute: experiment.hashAttribute,
    exposureQueryId,
    identifierType,
    setExposureQueryId,
    setIdentifierType,
    // A new source starts from its defaults; the saved one shows as it is.
    autoRepair: !sameSource,
    keepCurrentSelection: sameSource,
  });
  const changed =
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
          exposureQueryId: exposureQueryId ?? "",
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
          !sameSource && value.datasource
            ? "Metrics and segments that aren't from the new data source are removed."
            : undefined
        }
      />
      {selected?.properties?.exposureQueries ? (
        <AssignmentQueryFields
          selection={selection}
          placeholder="Choose..."
          progressive
        />
      ) : null}
    </ModalStandard>
  );
}
