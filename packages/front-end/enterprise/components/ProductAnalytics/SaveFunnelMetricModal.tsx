import { useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { FunnelDataset } from "shared/validators";
import { FactMetricInterface } from "shared/types/fact-table";
import {
  funnelDatasetToFunnelSettings,
  getFunnelSaveBlockers,
} from "shared/funnels";
import { isFunnelSupportedDatasourceType } from "shared/enterprise";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/ui/MultiSelectField";
import TagsInput from "@/components/Tags/TagsInput";
import { MetricWindowSettingsForm } from "@/components/Metrics/MetricForm/MetricWindowSettingsForm";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import useProjectOptions from "@/hooks/useProjectOptions";
import { getDefaultFactMetricProps } from "@/services/metrics";
import track from "@/services/track";
import { useUser } from "@/services/UserContext";

export interface SaveFunnelMetricModalProps {
  close: () => void;
  dataset: FunnelDataset;
  datasourceId: string;
  /** Called with the new metric so the explorer can link to what was created. */
  onSaved?: (metric: FactMetricInterface) => void;
  trackingSource?: string;
}

export default function SaveFunnelMetricModal({
  close,
  dataset,
  datasourceId,
  onSaved,
  trackingSource,
}: SaveFunnelMetricModalProps) {
  const { apiCall } = useAuth();
  const {
    datasources,
    getDatasourceById,
    getFactTableById,
    mutateDefinitions,
    project,
  } = useDefinitions();
  const { permissionsUtil } = useUser();
  const { metricDefaults } = useOrganizationMetricDefaults();
  const settings = useOrgSettings();
  const [error, setError] = useState<string | null>(null);

  const datasource = getDatasourceById(datasourceId);
  const primaryFactTable = getFactTableById(
    dataset.steps[0]?.factTableId ?? "",
  );

  const defaults = getDefaultFactMetricProps({
    metricDefaults,
    settings,
    project,
    datasources,
  });

  const blockers = getFunnelSaveBlockers({
    dataset,
    datasourceId,
    getFactTable: (id) => getFactTableById(id) ?? undefined,
    datasourceSupportsFunnels: datasource
      ? isFunnelSupportedDatasourceType(datasource.type)
      : true,
  });

  const form = useForm({
    defaultValues: {
      name: "",
      description: "",
      tags: [] as string[],
      windowSettings: defaults.windowSettings,
      projects: primaryFactTable?.projects?.length
        ? primaryFactTable.projects
        : project
          ? [project]
          : [],
    },
  });
  const selectedProjects = form.watch("projects");
  const canCreateFactMetric = permissionsUtil.canCreateFactMetric({
    projects: selectedProjects,
  });
  const projectOptions = useProjectOptions(
    (projectId) =>
      permissionsUtil.canCreateFactMetric({ projects: [projectId] }),
    selectedProjects,
  );

  const handleSubmit = form.handleSubmit(async (values) => {
    setError(null);
    if (blockers.length) {
      setError(blockers[0]);
      return;
    }
    if (!permissionsUtil.canCreateFactMetric({ projects: values.projects })) {
      setError(
        "You do not have permission to create Fact Metrics in the selected Projects.",
      );
      return;
    }

    const res = await apiCall<{ factMetric: FactMetricInterface }>(
      "/fact-metrics",
      {
        method: "POST",
        body: JSON.stringify({
          ...defaults,
          datasource: datasourceId,
          name: values.name,
          description: values.description,
          tags: values.tags,
          projects: values.projects,
          windowSettings: values.windowSettings,
          metricType: "funnel",
          funnelSettings: funnelDatasetToFunnelSettings(dataset),
          numerator: null,
          denominator: null,
          quantileSettings: null,
          cappingSettings: { type: "" as const, value: 0 },
          metricAutoSlices: [],
        }),
      },
    );

    track("Create Fact Metric", {
      type: "funnel",
      source: trackingSource ?? "funnel-builder",
    });
    await mutateDefinitions();
    onSaved?.(res.factMetric);
    close();
  });

  return (
    <ModalStandard
      open
      close={close}
      header="Save as funnel metric"
      cta="Save metric"
      submit={handleSubmit}
      ctaEnabled={blockers.length === 0 && canCreateFactMetric}
      size="md"
      trackingEventModalType="save-funnel-metric"
    >
      <Flex direction="column" gap="3">
        {error && <Callout status="error">{error}</Callout>}
        {blockers.length > 0 && (
          <Callout status="error">
            <Text weight="medium">This funnel can&apos;t be saved yet:</Text>
            <Box as="ul" mt="1" mb="0">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </Box>
          </Callout>
        )}
        {!canCreateFactMetric && (
          <Callout status="error">
            You do not have permission to create Fact Metrics in the selected
            Projects.
          </Callout>
        )}

        <Field
          label="Name"
          required
          autoFocus
          placeholder="e.g. Checkout funnel"
          {...form.register("name", { required: true })}
        />

        <Field
          label="Description"
          textarea
          minRows={2}
          {...form.register("description")}
        />

        <MetricWindowSettingsForm form={form} type="funnel" />

        <MultiSelectField
          label="Projects"
          value={selectedProjects}
          onChange={(v) => form.setValue("projects", v)}
          options={projectOptions}
          helpText="Leave empty to make the metric available in all projects."
        />

        <div>
          <Text as="label" weight="semibold">
            Tags
          </Text>
          <TagsInput
            value={form.watch("tags")}
            onChange={(v) => form.setValue("tags", v)}
          />
        </div>

        <Callout status="info">
          Two things change when a funnel becomes a metric:
          <Box as="ul" mt="1" mb="0">
            <li>
              The counting unit isn&apos;t carried over — in an experiment, the
              metric counts whatever the experiment&apos;s exposure table uses.
            </li>
            <li>
              Experiment results measure conversion against{" "}
              <strong>everyone exposed</strong>, not just users who reached step
              1, so the percentages there will be lower than here.
            </li>
          </Box>
        </Callout>

        <Text size="sm" color="text-low">
          Steps are saved as they are configured in the builder. Editing them
          here afterwards won&apos;t change this metric unless you update it.
        </Text>
      </Flex>
    </ModalStandard>
  );
}
