import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  PiCaretDownFill,
  PiPencilSimple,
  PiSlidersHorizontal,
} from "react-icons/pi";
import isEqual from "lodash/isEqual";
import { getMetricLink } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentAnalysisSettingsDraft } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
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
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import { useRegisterExperimentEdit } from "./ExperimentEdits";
import SetupFieldRow from "./SetupFieldRow";

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
  } = useDefinitions();
  const { defaultDataSource } = useOrgSettings();
  const { demoDataSourceId } = useDemoDataSourceProject();
  const { apiCall } = useAuth();

  // Settled plans are read-only until someone asks to change them.
  const started = experiment.status !== "draft";
  const [unlocked, setUnlocked] = useState(false);
  const [ownAdvancedOpen, setOwnAdvancedOpen] = useState(false);
  const advancedOpen = settingsOpen ?? ownAdvancedOpen;
  const setAdvancedOpen = setSettingsOpen ?? setOwnAdvancedOpen;
  // What the settings modal handed over, waiting on the page's save bar with
  // everything else. The fields this section shows are held in their own state
  // so the page keeps reading as one draft.
  const [advanced, setAdvanced] =
    useState<ExperimentAnalysisSettingsDraft | null>(null);
  const editable = canEdit && (!started || unlocked);

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
  const [error, setError] = useState<string | null>(null);
  // A suggested datasource is not a change until someone touches the form,
  // or every page load would raise the save bar on its own.
  const [touched, setTouched] = useState(false);

  const dirty =
    touched &&
    (advanced !== null ||
      datasource !== (experiment.datasource || "") ||
      exposureQueryId !== (experiment.exposureQueryId || "") ||
      !isEqual(goalMetrics, experiment.goalMetrics || []) ||
      !isEqual(secondaryMetrics, experiment.secondaryMetrics || []) ||
      !isEqual(guardrailMetrics, experiment.guardrailMetrics || []));

  useRegisterExperimentEdit("analysis-plan", dirty, {
    save: async () => {
      setError(null);
      try {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({
            ...advanced,
            datasource,
            exposureQueryId,
            goalMetrics,
            secondaryMetrics,
            guardrailMetrics,
          }),
        });
        setTouched(false);
        setAdvanced(null);
        mutate();
      } catch (e) {
        const message = e.message || "Could not save the analysis plan";
        setError(message);
        throw new Error(message);
      }
    },
    discard: () => {
      setAdvanced(null);
      setDatasource(experiment.datasource || suggestedDatasource);
      setExposureQueryId(experiment.exposureQueryId || "");
      setGoalMetrics(experiment.goalMetrics || []);
      setSecondaryMetrics(experiment.secondaryMetrics || []);
      setGuardrailMetrics(experiment.guardrailMetrics || []);
      setTouched(false);
      setError(null);
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
    if (!editable || !selectedDatasource) return;
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
    if (experiment.exposureQueryId) setTouched(true);
  }, [
    editable,
    selectedDatasource,
    datasource,
    hashAttribute,
    exposureQueryId,
    mismatched,
    experiment.exposureQueryId,
  ]);

  // Read-only lists the metrics by name: the selector renders nothing when it
  // has no setters and nothing selected, which would hide the row entirely.
  const activationMetric =
    advanced && "activationMetric" in advanced
      ? advanced.activationMetric
      : experiment.activationMetric;
  const segment =
    advanced && "segment" in advanced ? advanced.segment : experiment.segment;

  const metricList = (ids: string[]) =>
    ids.length ? (
      <Flex gap="2" wrap="wrap">
        {ids.map((id, i) => (
          <Link key={id} href={getMetricLink(id)}>
            {getExperimentMetricById(id)?.name || id}
            {i < ids.length - 1 ? "," : ""}
          </Link>
        ))}
      </Flex>
    ) : (
      <Text color="text-high">None</Text>
    );

  const metricRow = (
    label: string,
    tooltip: string,
    selected: string[],
    onChange: (ids: string[]) => void,
  ) => (
    <SetupFieldRow label={label} tooltip={tooltip}>
      {editable ? (
        <MetricsSelector
          selected={selected}
          onChange={(ids) => {
            setTouched(true);
            onChange(ids);
          }}
          datasource={datasource}
          exposureQueryId={exposureQueryId}
          project={experiment.project}
          includeFacts
          includeGroups
        />
      ) : (
        metricList(selected)
      )}
    </SetupFieldRow>
  );

  return (
    <>
      {advancedOpen ? (
        <AnalysisForm
          cancel={() => setAdvancedOpen(false)}
          experiment={experiment}
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
            setTouched(true);
            if (nextDatasource !== undefined) setDatasource(nextDatasource);
            if (nextExposureQueryId !== undefined)
              setExposureQueryId(nextExposureQueryId);
            if (nextGoalMetrics) setGoalMetrics(nextGoalMetrics);
            if (nextSecondaryMetrics) setSecondaryMetrics(nextSecondaryMetrics);
            if (nextGuardrailMetrics) setGuardrailMetrics(nextGuardrailMetrics);
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
              {editable ? (
                <DropdownMenu
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
                          setTouched(true);
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
                <Text color="text-high">
                  {selectedDatasource?.name || "None"}
                </Text>
              )}
            </Flex>
            {canEdit && started && !unlocked ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setUnlocked(true)}
              >
                <PiPencilSimple /> Edit
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAdvancedOpen(true)}
              >
                <PiSlidersHorizontal /> Analysis settings
              </Button>
            ) : null}
          </Flex>
        </Flex>

        <SetupFieldRow label="Assignment Query" tooltip={ASSIGNMENT_QUERY_HELP}>
          {editable ? (
            <SelectField
              value={exposureQueryId}
              onChange={(value) => {
                setTouched(true);
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
              disabled={!selectedDatasource}
            />
          ) : (
            <Text color="text-high">{exposureQuery?.name || "None"}</Text>
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
          >
            {metricList([activationMetric])}
          </SetupFieldRow>
        ) : null}

        {segment ? (
          <SetupFieldRow
            label="Segment"
            tooltip="Limits the analysis to users in this segment."
          >
            <Text color="text-high">
              {getSegmentById(segment)?.name || segment}
            </Text>
          </SetupFieldRow>
        ) : null}

        {metricRow(
          "Goal metrics",
          "What this experiment is trying to improve.",
          goalMetrics,
          setGoalMetrics,
        )}
        {metricRow(
          "Secondary metrics",
          "Extra metrics to learn from, but not the objective.",
          secondaryMetrics,
          setSecondaryMetrics,
        )}
        {metricRow(
          "Guardrail metrics",
          "Metrics to watch for harm, not to improve.",
          guardrailMetrics,
          setGuardrailMetrics,
        )}

        {error ? (
          <Callout status="error" size="sm" mt="2">
            {error}
          </Callout>
        ) : null}
      </Box>
    </>
  );
}
