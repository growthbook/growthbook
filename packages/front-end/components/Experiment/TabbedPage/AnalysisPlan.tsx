import { useMemo, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiCaretDownFill, PiPencilSimpleFill } from "react-icons/pi";
import isEqual from "lodash/isEqual";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import SelectField from "@/components/Forms/SelectField";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import { getAutoDatasourceId } from "@/components/Experiment/SimpleNewExperimentForm";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
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
}

/**
 * How the experiment will be analysed: where the data comes from, what counts
 * as a participant, and which metrics are being watched. Held as a draft and
 * written by the page's save bar.
 */
export default function AnalysisPlan({ experiment, mutate, canEdit }: Props) {
  const { datasources, getDatasourceById, getExperimentMetricById } =
    useDefinitions();
  const { defaultDataSource } = useOrgSettings();
  const { demoDataSourceId } = useDemoDataSourceProject();
  const { apiCall } = useAuth();

  // Settled plans are read-only until someone asks to change them.
  const started = experiment.status !== "draft";
  const [unlocked, setUnlocked] = useState(false);
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
    (datasource !== (experiment.datasource || "") ||
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
            datasource,
            exposureQueryId,
            goalMetrics,
            secondaryMetrics,
            guardrailMetrics,
          }),
        });
        setTouched(false);
        mutate();
      } catch (e) {
        const message = e.message || "Could not save the analysis plan";
        setError(message);
        throw new Error(message);
      }
    },
    discard: () => {
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

  // Read-only lists the metrics by name: the selector renders nothing when it
  // has no setters and nothing selected, which would hide the row entirely.
  const metricNames = (ids: string[]) =>
    ids.length
      ? ids.map((id) => getExperimentMetricById(id)?.name || id).join(", ")
      : "None";

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
        <Text color="text-high">{metricNames(selected)}</Text>
      )}
    </SetupFieldRow>
  );

  return (
    <>
      <Separator size="4" my="3" />
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
                <PiPencilSimpleFill /> Edit
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
              options={exposureQueries.map((q) => ({
                value: q.id,
                label: q.name,
              }))}
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
        </SetupFieldRow>

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
