import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiCaretDownFill, PiLockSimple, PiPencilSimple } from "react-icons/pi";
import isEqual from "lodash/isEqual";
import { getMetricLink } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  ExperimentAnalysisSettingsDraft,
  experimentAnalysisSettingsDraft,
} from "shared/validators";
import { getScopedSettings } from "shared/settings";
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
import AnalysisForm, {
  AnalysisFormFocus,
} from "@/components/Experiment/AnalysisForm";
import MetricOverridesModal from "@/components/Experiment/MetricOverridesModal";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import { useExperimentFieldEdit, useStagedState } from "./ExperimentEdits";
import SetupFieldRow from "./SetupFieldRow";
import { useDecisionFrameworkApplies } from "./DecisionMakingSettings";

type MetricField = "goalMetrics" | "secondaryMetrics" | "guardrailMetrics";
type PlanField = "datasource" | "exposureQueryId" | MetricField;

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  canEdit: boolean;
  envs: string[];
  // Lifted, since other parts of the page open the settings modal too.
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  settingsFocus?: AnalysisFormFocus | null;
}

export default function AnalysisPlan({
  experiment,
  mutate,
  canEdit,
  envs,
  settingsOpen,
  setSettingsOpen,
  settingsFocus = null,
}: Props) {
  const {
    datasources,
    getDatasourceById,
    getExperimentMetricById,
    getSegmentById,
    getProjectById,
  } = useDefinitions();
  const { organization } = useUser();
  const { defaultDataSource } = useOrgSettings();
  const { demoDataSourceId } = useDemoDataSourceProject();

  // Settings-modal edits beyond the fields held in their own state below.
  const [advanced, setAdvanced] =
    useStagedState<ExperimentAnalysisSettingsDraft | null>(
      "analysis-plan:advanced",
      null,
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
  const current = {
    datasource,
    exposureQueryId,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
  };
  const stored = (field: PlanField) =>
    experiment[field] ??
    (field === "datasource" || field === "exposureQueryId" ? "" : []);
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
      experiment.goalMetrics,
      experiment.secondaryMetrics,
      experiment.guardrailMetrics,
      suggestedDatasource,
      setDatasource,
      setExposureQueryId,
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
      ...Object.fromEntries(sent.map((field) => [field, current[field]])),
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
  const datasourceLabel = selectedDatasource
    ? selectedDatasource.name
    : hiddenDatasource
      ? restricted
      : "None";
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

  const metricRow = (
    label: string,
    tooltip: string,
    field: MetricField,
    selected: string[],
    onChange: (ids: string[]) => void,
  ) => (
    <SetupFieldRow label={label} tooltip={tooltip}>
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
            setAdvanced((prev) => ({ ...(prev ?? {}), ...parsed }));
            setOverridesFor(null);
          }}
        />
      ) : null}
      {settingsOpen ? (
        <AnalysisForm
          cancel={() => setSettingsOpen(false)}
          // Opens on the page's draft, so confirming hands back what it shows.
          experiment={{ ...effective, ...current }}
          mutate={mutate}
          phase={experiment.phases.length - 1}
          // Dates are a phase edit, with no place in this draft.
          editDates={false}
          editVariationIds={false}
          editMetrics={true}
          focus={settingsFocus}
          source="analysis-plan"
          envs={envs}
          stageChanges={(changes) => {
            const {
              datasource: nextDatasource,
              exposureQueryId: nextExposureQueryId,
              goalMetrics: nextGoalMetrics,
              secondaryMetrics: nextSecondaryMetrics,
              guardrailMetrics: nextGuardrailMetrics,
              ...rest
            } = changes;
            if (nextDatasource !== undefined) {
              touch("datasource");
              setDatasource(nextDatasource);
            }
            if (nextExposureQueryId !== undefined) {
              touch("exposureQueryId");
              setExposureQueryId(nextExposureQueryId);
            }
            if (nextGoalMetrics) {
              touch("goalMetrics");
              setGoalMetrics(nextGoalMetrics);
            }
            if (nextSecondaryMetrics) {
              touch("secondaryMetrics");
              setSecondaryMetrics(nextSecondaryMetrics);
            }
            if (nextGuardrailMetrics) {
              touch("guardrailMetrics");
              setGuardrailMetrics(nextGuardrailMetrics);
            }
            setAdvanced((prev) => ({ ...(prev ?? {}), ...rest }));
            setSettingsOpen(false);
          }}
        />
      ) : null}
      <Separator size="4" my="2" />
      <Box py="4">
        <Flex align="center" justify="between" mb="1">
          <Heading color="text-high" as="h4" size="sm" mb="0">
            Analysis Plan
          </Heading>
          <Flex align="center" gap="3">
            <Flex align="center" gap="1">
              <Text as="label" weight="medium" color="text-low" mb="0">
                Data source:
              </Text>
              {canEdit ? (
                <DropdownMenu
                  menuPlacement="end"
                  variant="soft"
                  trigger={
                    <Link
                      type="button"
                      style={{ color: "var(--color-text-high)" }}
                    >
                      <Text mr="1">{datasourceLabel}</Text>
                      <PiCaretDownFill />
                    </Link>
                  }
                >
                  <DropdownMenuGroup>
                    {[
                      { id: "", name: "None" },
                      ...datasources.filter((d) => d.id !== demoDataSourceId),
                    ].map((d) => (
                      <DropdownMenuItem
                        key={d.id || "none"}
                        onClick={() => {
                          if (d.id === datasource) return;
                          touch("datasource", "exposureQueryId");
                          setDatasource(d.id);
                          // The old query belongs to the old source.
                          setExposureQueryId("");
                        }}
                      >
                        {d.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenu>
              ) : (
                <Text color="text-high">{datasourceLabel}</Text>
              )}
            </Flex>
            {canEdit ? (
              <Button
                variant="ghost"
                icon={<PiPencilSimple />}
                onClick={() => setSettingsOpen(true)}
              >
                Additional settings
              </Button>
            ) : null}
          </Flex>
        </Flex>

        <SetupFieldRow
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
      </Box>
    </>
  );
}
