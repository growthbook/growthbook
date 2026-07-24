import React, { FC } from "react";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { useForm } from "react-hook-form";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import MultiSelectField from "@/ui/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import useProjectOptions from "@/hooks/useProjectOptions";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import SelectField from "@/components/Forms/SelectField";

const MetricGroupModal: FC<{
  existingMetricGroup?: MetricGroupInterface;
  close: () => void;
  mutate: () => void;
}> = ({ existingMetricGroup = null, close, mutate }) => {
  const { projects, datasources, getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const { apiCall } = useAuth();
  const metricGroupId = existingMetricGroup?.id || null;
  const edit = !!metricGroupId;
  const form = useForm({
    defaultValues: {
      name: existingMetricGroup?.name || "",
      description: existingMetricGroup?.description || "",
      datasource: existingMetricGroup?.datasource || "",
      projects: existingMetricGroup?.projects || [],
      metrics: existingMetricGroup?.metrics || [],
    },
  });
  const datasource = getDatasourceById(form.watch("datasource"));

  const projectOptions = useProjectOptions(
    () => permissionsUtil.canCreateMetricGroup(),
    form.watch("projects") || [],
  );

  return (
    <ModalStandard
      trackingEventModalType=""
      header={existingMetricGroup ? "Edit Metric Group" : "Add Metric Group"}
      open={true}
      submit={form.handleSubmit(async (value) => {
        if (edit) {
          // update
          const results = await apiCall<{ metricGroup: MetricGroupInterface }>(
            `/metric-group/${metricGroupId}`,
            {
              method: "PUT",
              body: JSON.stringify({
                name: value.name,
                description: value.description,
                datasource: value.datasource,
                projects: value.projects,
                metrics: value.metrics,
              }),
            },
          );
          if (!results) {
            throw new Error(
              "Failed to create or update metric group. Please try again.",
            );
          }
        } else {
          // create
          const results = await apiCall<{ metricGroup: MetricGroupInterface }>(
            `/metric-group`,
            {
              method: "POST",
              body: JSON.stringify({
                name: value.name,
                description: value.description,
                datasource: value.datasource,
                projects: value.projects,
                metrics: value.metrics,
              }),
            },
          );
          if (!results || !results.metricGroup) {
            throw new Error(
              "Failed to create or update metric group. Please try again.",
            );
          }
        }

        await mutate();
      })}
      cta="Save"
      close={close}
    >
      <Field
        size="legacy"
        label="Name"
        {...form.register("name")}
        required={true}
      />
      <Field
        size="legacy"
        label="Description"
        type="textarea"
        maxLength={MAX_DESCRIPTION_LENGTH}
        {...form.register("description")}
      />
      {projects?.length > 0 && (
        <div className="form-group">
          <MultiSelectField
            size="legacy"
            label={
              <>
                Projects{" "}
                <Tooltip
                  body={`The dropdown below has been filtered to only include projects where you have permissions`}
                />
              </>
            }
            placeholder="All Projects"
            value={form.watch("projects") || []}
            options={projectOptions}
            onChange={(v) => form.setValue("projects", v)}
            customClassName="label-overflow-ellipsis"
          />
        </div>
      )}
      <div className="form-group">
        <SelectField
          size="legacy"
          required={true}
          label="Data Source"
          value={datasource?.id || ""}
          onChange={(newDatasource) => {
            form.setValue("datasource", newDatasource);
          }}
          options={datasources.map((d) => ({
            value: d.id,
            label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
          }))}
          className="portal-overflow-ellipsis"
        />
      </div>
      {datasource?.id && (
        <div className="form-group">
          <label>Metrics in group</label>
          <p className="small text-muted" style={{ lineHeight: "10px" }}>
            You can add more and adjust the order later
          </p>
          <MetricsSelector
            datasource={form.watch("datasource")}
            includeFacts={true}
            includeGroups={false}
            selected={form.watch("metrics")}
            onChange={(value) => {
              form.setValue("metrics", value || "");
            }}
          />
        </div>
      )}
    </ModalStandard>
  );
};

export default MetricGroupModal;
