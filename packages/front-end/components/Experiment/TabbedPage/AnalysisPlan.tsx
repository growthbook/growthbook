import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiCaretDownFill, PiPencilSimple } from "react-icons/pi";
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
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import MetricOverridesModal from "@/components/Experiment/MetricOverridesModal";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import {
  experimentFieldChanges,
  useRegisterExperimentEdit,
} from "./ExperimentEdits";
import SetupFieldRow from "./SetupFieldRow";

type MetricField = "goalMetrics" | "secondaryMetrics" | "guardrailMetrics";
type PlanField = "datasource" | "exposureQueryId" | MetricField;

const ASSIGNMENT_QUERY_HELP =
  "Defines who is in the experiment and how they are identified.";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  canEdit: boolean;
  /** Passed through to the advanced settings modal. */
  envs: string[];
  /**
   * The settings modal's open state, when something else on the page opens it
   * too. Owned here otherwise.
   */
  settingsOpen?: boolean;
  setSettingsOpen?: (open: boolean) => void;
}

/**
 * How the experiment will be analysed: where the data comes from, what counts
 * as a participant, and which metrics are being watched. Held as a draft and
 * written by the page's save bar.
 */
export default function AnalysisPlan({
  experiment,
  mutate,
  canEdit,
  envs,
  settingsOpen,
  setSettingsOpen,
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

  const [ownAdvancedOpen, setOwnAdvancedOpen] = useState(false);
  const advancedOpen = settingsOpen ?? ownAdvancedOpen;
  const setAdvancedOpen = setSettingsOpen ?? setOwnAdvancedOpen;
  // What the settings modal handed over, waiting on the page's save bar with
  // everything else. The fields this section shows are held in their own state
  // so the page keeps reading as one draft.
  const [advanced, setAdvanced] =
    useState<ExperimentAnalysisSettingsDraft | null>(null);

  // The overrides as the page holds them: a staged edit reads before the save.
  const metricOverrides =
    (advanced && "metricOverrides" in advanced
      ? advanced.metricOverrides
      : experiment.metricOverrides) ?? [];
  // The engine as the page holds it, a staged change included.
  const statsEngine = getScopedSettings({
    organization,
    project: getProjectById(experiment.project || "") ?? undefined,
    experiment:
      advanced && "statsEngine" in advanced
        ? { ...experiment, statsEngine: advanced.statsEngine }
        : experiment,
  }).settings.statsEngine.value;
  // What a metric's card resolves its settings against: the page's draft.
  const settingsScope = useMemo(
    () => ({ experiment: { ...experiment, ...advanced }, statsEngine }),
    [experiment, advanced, statsEngine],
  );
  // Which metrics the overrides editor opened for, or null while it is shut.
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

  const [datasource, setDatasource] = useState(
    experiment.datasource || suggestedDatasource,
  );
  const [exposureQueryId, setExposureQueryId] = useState(
    experiment.exposureQueryId || "",
  );
  const [goalMetrics, setGoalMetrics] = useState(experiment.goalMetrics || []);
  const [secondaryMetrics, setSecondaryMetrics] = useState(
    experiment.secondaryMetrics || [],
  );
  const [guardrailMetrics, setGuardrailMetrics] = useState(
    experiment.guardrailMetrics || [],
  );
  // Only what someone changed here is sent, so a write from elsewhere on the
  // page isn't reverted by the copy this section holds. A suggested datasource
  // isn't a change until touched, or every load would raise the save bar.
  const [touched, setTouched] = useState<ReadonlySet<PlanField>>(new Set());
  const touch = (...fields: PlanField[]) =>
    setTouched((prev) => new Set([...prev, ...fields]));
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
  // What the page filled in where the experiment has nothing goes with any
  // edit, since it shows as chosen.
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
    ],
  );
  useEffect(() => resync(touchedRef.current), [resync]);

  useRegisterExperimentEdit("analysis-plan", dirty, {
    changes: () =>
      experimentFieldChanges(experiment, {
        ...advanced,
        ...Object.fromEntries(sent.map((field) => [field, current[field]])),
      }),
    onSaved: () => {
      setTouched(new Set());
      setAdvanced(null);
    },
    discard: () => {
      setAdvanced(null);
      setTouched(new Set());
      resync(new Set(), false);
    },
  });

  const selectedDatasource = getDatasourceById(datasource);
  const exposureQueries = selectedDatasource?.settings?.queries?.exposure ?? [];
  const exposureQuery = exposureQueries.find((q) => q.id === exposureQueryId);

  // What the experiment buckets on decides which queries can analyse it.
  const hashAttribute = experiment.hashAttribute || "";
  const { matching, other, linked } = useMemo(
    () =>
      getExposureQueriesForAttribute(
        selectedDatasource?.settings,
        hashAttribute,
      ),
    [selectedDatasource?.settings, hashAttribute],
  );
  const mismatched =
    linked &&
    !!exposureQueryId &&
    !matching.some((q) => q.id === exposureQueryId);

  // Follow the assignment attribute: when the query it leaves behind cannot
  // analyse the experiment, take the one that can — but only where the
  // attribute names a single query, and never over a deliberate choice that
  // still works.
  const autoAppliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!canEdit || !selectedDatasource) return;
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
  ]);

  const activationMetric =
    advanced && "activationMetric" in advanced
      ? advanced.activationMetric
      : experiment.activationMetric;
  const segment =
    advanced && "segment" in advanced ? advanced.segment : experiment.segment;

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
          close={() => setOverridesFor(null)}
          stageChanges={(next) => {
            // The same bounds the full settings modal stages through, so only
            // well-formed overrides reach the draft.
            const { metricOverrides: parsed } =
              experimentAnalysisSettingsDraft.parse({ metricOverrides: next });
            setAdvanced((prev) => ({
              ...(prev ?? {}),
              metricOverrides: parsed,
            }));
            setOverridesFor(null);
          }}
        />
      ) : null}
      {advancedOpen ? (
        <AnalysisForm
          cancel={() => setAdvancedOpen(false)}
          // Opens on the page's draft, so confirming hands back what it shows.
          experiment={{ ...settingsScope.experiment, ...current }}
          mutate={mutate}
          phase={experiment.phases.length - 1}
          // Dates are a phase edit, not an analysis setting: they have no place
          // in this draft, so the modal does not offer them here.
          editDates={false}
          editVariationIds={false}
          editMetrics={true}
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
            setAdvancedOpen(false);
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
              <DropdownMenu
                disabled={!canEdit}
                menuPlacement="end"
                variant="soft"
                trigger={
                  <Link
                    type="button"
                    style={{ color: "var(--color-text-high)" }}
                  >
                    <Text mr="1">{selectedDatasource?.name || "None"}</Text>
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
            </Flex>
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAdvancedOpen(true)}
              >
                <PiPencilSimple /> Additional settings
              </Button>
            ) : null}
          </Flex>
        </Flex>

        <SetupFieldRow label="Assignment Query" tooltip={ASSIGNMENT_QUERY_HELP}>
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
                      options: matching.map((q) => ({
                        value: q.id,
                        label: q.name,
                      })),
                    },
                    ...(other.length > 0
                      ? [
                          {
                            label: "Other assignment queries",
                            options: other.map((q) => ({
                              value: q.id,
                              label: q.name,
                            })),
                          },
                        ]
                      : []),
                  ]
                : exposureQueries.map((q) => ({
                    value: q.id,
                    label: q.name,
                  }))
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
