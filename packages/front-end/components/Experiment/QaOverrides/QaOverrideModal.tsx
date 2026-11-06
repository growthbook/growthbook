import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlusBold, PiXBold } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  ExperimentQaOverrideAssignment,
  ExperimentQaOverrideInterface,
  QaOverrideFilters,
} from "shared/types/experiment-qa-override";
import { SavedGroupTargeting } from "shared/validators";
import { getLatestPhaseVariations } from "shared/experiments";
import { isProductionEnvironment, qaOverrideHasCondition } from "shared/util";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioCards from "@/ui/RadioCards";
import RadioGroup from "@/ui/RadioGroup";
import { Select, SelectItem } from "@/ui/Select";
import MultiSelectField from "@/ui/MultiSelectField";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import VariationLabel from "@/ui/VariationLabel";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import QaOverrideFeatureGate from "./QaOverrideFeatureGate";
import { getQaOverrideWaitingFeatures } from "./QaOverrideSummary";

export type QaOverrideModalExperiment = Pick<
  ExperimentInterfaceStringDates,
  "id" | "name" | "project" | "hashAttribute" | "variations" | "phases"
>;

type FilterKind = "attributes" | "savedGroups" | "sdkConnections" | "projects";

const FILTER_LABELS: Record<FilterKind, string> = {
  attributes: "Attributes",
  savedGroups: "Saved Groups",
  sdkConnections: "SDK Connections",
  projects: "Projects",
};

type FormValues = {
  environment: string;
  assignmentType: ExperimentQaOverrideAssignment["type"];
  forcedVariationId: string;
  condition: string;
  savedGroups: SavedGroupTargeting[];
  sdkConnections: string[];
  projects: string[];
};

function activeFiltersFrom(filters?: QaOverrideFilters): FilterKind[] {
  if (!filters) return [];
  const kinds: FilterKind[] = [];
  if (qaOverrideHasCondition(filters)) kinds.push("attributes");
  if (filters.savedGroups?.length) kinds.push("savedGroups");
  if (filters.sdkConnections?.length) kinds.push("sdkConnections");
  if (filters.projects?.length) kinds.push("projects");
  return kinds;
}

export default function QaOverrideModal({
  experiment,
  linkedFeatures,
  existing,
  close,
  onSaved,
  onFeatureChanged,
}: {
  experiment: QaOverrideModalExperiment;
  linkedFeatures?: LinkedFeatureInfo[];
  existing?: ExperimentQaOverrideInterface;
  close: () => void;
  onSaved: () => Promise<unknown> | void;
  onFeatureChanged?: () => Promise<unknown> | void;
}) {
  const { apiCall } = useAuth();
  const environments = useEnvironments();
  const { projects } = useDefinitions();
  const { data: connectionData } = useSDKConnections();

  const variations = getLatestPhaseVariations(experiment);
  const phase = experiment.phases[experiment.phases.length - 1];

  const environmentOptions = useMemo(
    () =>
      environments.map((e) => ({
        id: e.id,
        isProduction: isProductionEnvironment(e),
      })),
    [environments],
  );
  const eligibleEnvironments = environmentOptions.filter(
    (e) => !e.isProduction,
  );

  const form = useForm<FormValues>({
    defaultValues: {
      environment:
        existing?.environment ??
        (eligibleEnvironments.length === 1 ? eligibleEnvironments[0].id : ""),
      assignmentType: existing?.assignment.type ?? "forced",
      forcedVariationId:
        existing?.assignment.type === "forced"
          ? existing.assignment.variationId
          : "",
      condition: existing?.filters.condition ?? "{}",
      savedGroups: existing?.filters.savedGroups ?? [],
      sdkConnections: existing?.filters.sdkConnections ?? [],
      projects: existing?.filters.projects ?? [],
    },
  });
  const [activeFilters, setActiveFilters] = useState<FilterKind[]>(() =>
    activeFiltersFrom(existing?.filters),
  );

  const values = form.watch();

  const connectionOptions = useMemo(
    () =>
      (connectionData?.connections ?? [])
        .filter((c) => c.environment === values.environment)
        .map((c) => ({ value: c.id, label: c.name })),
    [connectionData, values.environment],
  );
  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name })),
    [projects],
  );

  const waitingFeatures = values.environment
    ? getQaOverrideWaitingFeatures(
        { environment: values.environment },
        linkedFeatures,
      )
    : [];

  const addFilter = (kind: FilterKind) =>
    setActiveFilters((current) =>
      current.includes(kind) ? current : [...current, kind],
    );
  const removeFilter = (kind: FilterKind) => {
    setActiveFilters((current) => current.filter((k) => k !== kind));
    if (kind === "attributes") form.setValue("condition", "{}");
    if (kind === "savedGroups") form.setValue("savedGroups", []);
    if (kind === "sdkConnections") form.setValue("sdkConnections", []);
    if (kind === "projects") form.setValue("projects", []);
  };
  const availableFilters = (Object.keys(FILTER_LABELS) as FilterKind[]).filter(
    (k) => !activeFilters.includes(k),
  );

  const buildFilters = (): QaOverrideFilters => ({
    ...(activeFilters.includes("attributes") && values.condition !== "{}"
      ? { condition: values.condition }
      : {}),
    ...(activeFilters.includes("savedGroups") && values.savedGroups.length
      ? { savedGroups: values.savedGroups }
      : {}),
    ...(activeFilters.includes("sdkConnections") && values.sdkConnections.length
      ? { sdkConnections: values.sdkConnections }
      : {}),
    ...(activeFilters.includes("projects") && values.projects.length
      ? { projects: values.projects }
      : {}),
  });

  const buildAssignment = (): ExperimentQaOverrideAssignment =>
    values.assignmentType === "forced"
      ? { type: "forced", variationId: values.forcedVariationId }
      : { type: "random" };

  const valid =
    !!values.environment &&
    (values.assignmentType === "random" || !!values.forcedVariationId);

  return (
    <ModalStandard
      open={true}
      close={close}
      header={existing ? "Edit QA Override" : "Add QA Override"}
      subheader={experiment.name}
      cta="Save override"
      ctaEnabled={valid}
      size="md"
      trackingEventModalType="experiment-qa-override"
      submit={form.handleSubmit(async (value) => {
        const body = { filters: buildFilters(), assignment: buildAssignment() };
        if (existing) {
          await apiCall(`/qa-overrides/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        } else {
          await apiCall(`/qa-overrides/experiment/${experiment.id}`, {
            method: "POST",
            body: JSON.stringify({ ...body, environment: value.environment }),
          });
        }
        await onSaved();
      })}
    >
      <Flex direction="column" gap="5">
        <Box>
          <Heading as="h3" size="sm" mb="1">
            Environment
          </Heading>
          {existing ? (
            <Metadata
              label="Environment"
              value={<Badge label={existing.environment} color="gray" />}
            />
          ) : (
            <>
              <Select
                value={values.environment}
                setValue={(v) => {
                  form.setValue("environment", v);
                  // Connections belong to one environment, so a different
                  // environment makes any connection filter meaningless.
                  form.setValue("sdkConnections", []);
                }}
                placeholder="Select an environment..."
              >
                {environmentOptions.map((e) => (
                  <SelectItem key={e.id} value={e.id} disabled={e.isProduction}>
                    {e.id}
                    {e.isProduction ? " (production)" : ""}
                  </SelectItem>
                ))}
              </Select>
              <Text as="p" size="sm" color="text-low" mt="1">
                QA overrides aren&apos;t available on production. To use one of
                those environments, turn off &quot;This is a production
                environment&quot; in{" "}
                <Link href="/environments">Settings → Environments</Link>.
              </Text>
            </>
          )}
        </Box>

        <Box>
          <Flex align="center" justify="between" mb="1">
            <Heading as="h3" size="sm" mb="0">
              Filters
            </Heading>
            {availableFilters.length > 0 && (
              <DropdownMenu
                trigger={
                  <Button variant="ghost" size="sm" icon={<PiPlusBold />}>
                    Add filter
                  </Button>
                }
                menuPlacement="end"
              >
                {availableFilters.map((kind) => (
                  <DropdownMenuItem key={kind} onClick={() => addFilter(kind)}>
                    {FILTER_LABELS[kind]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenu>
            )}
          </Flex>
          {activeFilters.length === 0 ? (
            <Text as="p" size="sm" color="text-low">
              No filters: every request in this environment gets the override.
              Add one to narrow it to specific users, saved groups, SDK
              Connections or projects.
            </Text>
          ) : (
            <Flex direction="column" gap="4" mt="2">
              {activeFilters.map((kind) => (
                <Box key={kind}>
                  <Flex align="center" justify="between" mb="1">
                    <Text weight="medium">{FILTER_LABELS[kind]}</Text>
                    <Button
                      variant="ghost"
                      color="gray"
                      size="sm"
                      icon={<PiXBold />}
                      onClick={() => removeFilter(kind)}
                    >
                      Remove
                    </Button>
                  </Flex>
                  {kind === "attributes" && (
                    <ConditionInput
                      defaultValue={values.condition}
                      onChange={(v) => form.setValue("condition", v)}
                      project={experiment.project || ""}
                      emptyText=""
                      slimMode
                    />
                  )}
                  {kind === "savedGroups" && (
                    <SavedGroupTargetingField
                      value={values.savedGroups}
                      setValue={(v) => form.setValue("savedGroups", v)}
                      project={experiment.project || ""}
                      slimMode
                    />
                  )}
                  {kind === "sdkConnections" && (
                    <MultiSelectField
                      value={values.sdkConnections}
                      onChange={(v) => form.setValue("sdkConnections", v)}
                      options={connectionOptions}
                      placeholder={
                        values.environment
                          ? `Select SDK Connections in ${values.environment}...`
                          : "Select an environment first"
                      }
                      disabled={!values.environment}
                    />
                  )}
                  {kind === "projects" && (
                    <MultiSelectField
                      value={values.projects}
                      onChange={(v) => form.setValue("projects", v)}
                      options={projectOptions}
                      placeholder="Select projects..."
                    />
                  )}
                </Box>
              ))}
            </Flex>
          )}
        </Box>

        {waitingFeatures.length > 0 && (
          <Callout status="warning">
            <Text as="p" mb="2">
              This override won&apos;t apply through{" "}
              {waitingFeatures.length === 1
                ? "this Feature Flag"
                : "these Feature Flags"}{" "}
              until {waitingFeatures.length === 1 ? "it is" : "they are"} on in{" "}
              <Text weight="medium">{values.environment}</Text>. You can still
              save it now.
            </Text>
            <QaOverrideFeatureGate
              environment={values.environment}
              linkedFeatures={linkedFeatures}
              onChanged={onFeatureChanged}
            />
          </Callout>
        )}

        <Box>
          <Heading as="h3" size="sm" mb="2">
            Which Variation?
          </Heading>
          <RadioCards
            columns="1"
            value={values.assignmentType}
            setValue={(v) =>
              form.setValue(
                "assignmentType",
                v as ExperimentQaOverrideAssignment["type"],
              )
            }
            options={[
              {
                value: "random",
                label: "Random assignment",
                description: `Run the experiment as configured: hashing on ${
                  experiment.hashAttribute || "id"
                }, ${(phase?.variationWeights ?? [])
                  .map((w) => Math.round(w * 100))
                  .join(" / ")} split, ${Math.round(
                  (phase?.coverage ?? 1) * 100,
                )}% coverage, ${experimentTargetingDescription(
                  experiment,
                )}. Holdouts are ignored.`,
              },
              {
                value: "forced",
                label: "Force variation",
                description:
                  "Everyone matching the filters gets one variation. Experiment targeting, coverage, namespaces and holdouts are ignored.",
              },
            ]}
          />
          {values.assignmentType === "forced" && (
            <Box mt="3" ml="2">
              <RadioGroup
                value={values.forcedVariationId}
                setValue={(v) => form.setValue("forcedVariationId", v)}
                options={variations.map((v, i) => ({
                  value: v.id,
                  label: <VariationLabel number={i} name={v.name} />,
                }))}
              />
            </Box>
          )}
        </Box>

        <Callout status="info">
          Removed automatically when the experiment starts.
        </Callout>
      </Flex>
    </ModalStandard>
  );
}

function experimentTargetingDescription(
  experiment: QaOverrideModalExperiment,
): string {
  const phase = experiment.phases[experiment.phases.length - 1];
  if (!phase) return "no targeting";
  const parts: string[] = [];
  if (phase.condition && phase.condition !== "{}") {
    parts.push("attribute targeting");
  }
  if (phase.savedGroups?.length) {
    parts.push(
      `${phase.savedGroups.length} saved group rule${
        phase.savedGroups.length === 1 ? "" : "s"
      }`,
    );
  }
  if (phase.prerequisites?.length) {
    parts.push(
      `${phase.prerequisites.length} prerequisite${
        phase.prerequisites.length === 1 ? "" : "s"
      }`,
    );
  }
  if (phase.namespace?.enabled && phase.namespace.name) {
    parts.push(`namespace ${phase.namespace.name}`);
  }
  return parts.length ? parts.join(", ") : "no targeting";
}
