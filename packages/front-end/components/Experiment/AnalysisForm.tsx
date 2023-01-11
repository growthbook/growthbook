import { FC } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import {
  AttributionModel,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import { FaQuestionCircle } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getValidDate } from "@/services/dates";
import { getExposureQuery } from "@/services/datasources";
import Modal from "../Modal";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import { AttributionModelTooltip } from "./AttributionModelTooltip";

const AnalysisForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  phase: number;
  cancel: () => void;
  mutate: () => void;
  editVariationIds?: boolean;
  editDates?: boolean;
}> = ({
  experiment,
  cancel,
  mutate,
  phase,
  editVariationIds = true,
  editDates = true,
}) => {
  const {
    metrics,
    segments,
    getDatasourceById,
    datasources,
  } = useDefinitions();

  const phaseObj = experiment.phases[phase];

  const form = useForm({
    defaultValues: {
      trackingKey: experiment.trackingKey || "",
      datasource: experiment.datasource || "",
      exposureQueryId:
        getExposureQuery(
          getDatasourceById(experiment.datasource)?.settings,
          experiment.exposureQueryId,
          experiment.userIdType
        )?.id || "",
      activationMetric: experiment.activationMetric || "",
      segment: experiment.segment || "",
      queryFilter: experiment.queryFilter || "",
      skipPartialData: experiment.skipPartialData ? "strict" : "loose",
      removeMultipleExposures: experiment.removeMultipleExposures
        ? "remove"
        : "keep",
      attributionModel: experiment.attributionModel || "firstExposure",
      dateStarted: getValidDate(phaseObj?.dateStarted)
        .toISOString()
        .substr(0, 16),
      dateEnded: getValidDate(phaseObj?.dateEnded).toISOString().substr(0, 16),
      variations: experiment.variations || [],
    },
  });
  const { apiCall } = useAuth();

  const datasource = getDatasourceById(form.watch("datasource"));
  const datasourceProperties = datasource?.properties;

  const filteredMetrics = metrics.filter(
    (m) => m.datasource === datasource?.id
  );
  const filteredSegments = segments.filter(
    (s) => s.datasource === datasource?.id
  );

  // Error: Type instantiation is excessively deep and possibly infinite.
  // eslint-disable-next-line
  // @ts-ignore
  const variations = useFieldArray({
    control: form.control,
    name: "variations",
  });

  const exposureQueries = datasource?.settings?.queries?.exposure || [];
  const exposureQueryId = form.watch("exposureQueryId");
  const exposureQuery = exposureQueries.find((e) => e.id === exposureQueryId);

  return (
    <Modal
      header={"Configure Experiment Analysis"}
      open={true}
      close={cancel}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        const {
          dateStarted,
          dateEnded,
          skipPartialData,
          removeMultipleExposures,
          ...values
        } = value;

        const body: Partial<ExperimentInterfaceStringDates> & {
          phaseStartDate: string;
          phaseEndDate?: string;
          currentPhase?: number;
        } = {
          ...values,
          currentPhase: phase,
          phaseStartDate: dateStarted,
          skipPartialData: skipPartialData === "strict",
          removeMultipleExposures: removeMultipleExposures === "remove",
        };

        // Metrics/guardrails are tied to a data source, so if we change it, they need to be removed.
        if (body.datasource !== experiment.datasource) {
          body.metrics = [];
          body.guardrails = [];
        }

        if (experiment.status === "stopped") {
          body.phaseEndDate = dateEnded;
        }

        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        mutate();
      })}
      cta="Save"
    >
      <SelectField
        label="Data Source"
        labelClassName="font-weight-bold"
        value={datasource?.id || ""}
        onChange={(newDatasource) => {
          if (datasource && newDatasource !== datasource?.id) {
            form.setValue("segment", "");
            form.setValue("activationMetric", "");
            form.setValue("exposureQueryId", "");
          }
          form.setValue("datasource", newDatasource);
        }}
        options={datasources.map((d) => ({
          value: d.id,
          label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
        }))}
        className="portal-overflow-ellipsis"
        initialOption="Manual"
        helpText={
          <>
            <strong className="text-danger">Warning:</strong> Changing this will
            remove all metrics and segments from the experiment.
          </>
        }
      />
      {datasource?.properties?.exposureQueries && (
        <SelectField
          label="Experiment Assignment Table"
          labelClassName="font-weight-bold"
          value={form.watch("exposureQueryId")}
          onChange={(v) => form.setValue("exposureQueryId", v)}
          initialOption="Choose..."
          required
          options={exposureQueries.map((q) => {
            return {
              label: q.name,
              value: q.id,
            };
          })}
        />
      )}
      <Field
        label="Experiment Id"
        labelClassName="font-weight-bold"
        {...form.register("trackingKey")}
        helpText="Will match against the experiment_id column in your data source"
      />
      {editVariationIds && (
        <div className="form-group">
          <label className="font-weight-bold">Variation Ids</label>
          <div className="row align-items-top">
            {variations.fields.map((v, i) => (
              <div
                className={`col-${Math.max(
                  Math.round(12 / variations.fields.length),
                  3
                )} mb-2`}
                key={i}
              >
                <Field
                  label={v.name}
                  labelClassName="mb-0"
                  containerClassName="mb-1"
                  {...form.register(`variations.${i}.key`)}
                  placeholder={i + ""}
                />
              </div>
            ))}
          </div>
          <small className="form-text text-muted">
            Will match against the variation_id column in your data source
          </small>
        </div>
      )}
      {phaseObj && editDates && (
        <div className="row">
          <div className="col">
            <Field
              label="Start Date (UTC)"
              labelClassName="font-weight-bold"
              type="datetime-local"
              {...form.register("dateStarted")}
              helpText="Only include users who entered the experiment on or after this date"
            />
          </div>
          {experiment.status === "stopped" && (
            <div className="col">
              <Field
                label="End Date (UTC)"
                labelClassName="font-weight-bold"
                type="datetime-local"
                {...form.register("dateEnded")}
                helpText="Only include users who entered the experiment on or before this date"
              />
            </div>
          )}
        </div>
      )}
      <SelectField
        label="Activation Metric"
        labelClassName="font-weight-bold"
        options={filteredMetrics.map((m) => {
          return {
            label: m.name,
            value: m.id,
          };
        })}
        initialOption="None"
        value={form.watch("activationMetric")}
        onChange={(value) => form.setValue("activationMetric", value || "")}
        helpText="Users must convert on this metric before being included"
      />
      {datasourceProperties?.experimentSegments && (
        <SelectField
          label="Segment"
          labelClassName="font-weight-bold"
          value={form.watch("segment")}
          onChange={(value) => form.setValue("segment", value || "")}
          initialOption="None (All Users)"
          options={filteredSegments.map((s) => {
            return {
              label: s.name,
              value: s.id,
            };
          })}
          helpText="Only users in this segment will be included"
        />
      )}
      {datasourceProperties?.separateExperimentResultQueries && (
        <SelectField
          label="Metric Conversion Windows"
          labelClassName="font-weight-bold"
          value={form.watch("skipPartialData")}
          onChange={(value) => form.setValue("skipPartialData", value)}
          options={[
            {
              label: "Include In-Progress Conversions",
              value: "loose",
            },
            {
              label: "Exclude In-Progress Conversions",
              value: "strict",
            },
          ]}
          helpText="How to treat users who have not had the full time to convert yet"
        />
      )}
      {datasourceProperties?.separateExperimentResultQueries && (
        <SelectField
          label="Users in Multiple Variations"
          labelClassName="font-weight-bold"
          value={form.watch("removeMultipleExposures")}
          onChange={(value) => form.setValue("removeMultipleExposures", value)}
          options={[
            {
              label: "Include in both variations",
              value: "keep",
            },
            {
              label: "Remove from analysis",
              value: "remove",
            },
          ]}
          helpText="How to treat users who were exposed to more than 1 variation"
        />
      )}
      {datasourceProperties?.separateExperimentResultQueries && (
        <SelectField
          label={
            <AttributionModelTooltip>
              <strong>Attribution Model</strong> <FaQuestionCircle />
            </AttributionModelTooltip>
          }
          value={form.watch("attributionModel")}
          onChange={(value) => {
            const model = value as AttributionModel;
            form.setValue("attributionModel", model);
          }}
          options={[
            {
              label: "First Exposure",
              value: "firstExposure",
            },
            {
              label: "All Exposures",
              value: "allExposures",
            },
          ]}
        />
      )}
      {datasourceProperties?.queryLanguage === "sql" && (
        <div className="row">
          <div className="col">
            <Field
              label="Custom SQL Filter"
              labelClassName="font-weight-bold"
              {...form.register("queryFilter")}
              textarea
              placeholder="e.g. user_id NOT IN ('123', '456')"
              helpText="WHERE clause to add to the default experiment query"
            />
          </div>
          <div className="pt-2 border-left col-sm-4 col-lg-6">
            Available columns:
            <div className="mb-2 d-flex flex-wrap">
              {["timestamp", "variation_id"]
                .concat(exposureQuery ? [exposureQuery.userIdType] : [])
                .concat(exposureQuery?.dimensions || [])
                .map((d) => {
                  return (
                    <div className="mr-2 mb-2 border px-1" key={d}>
                      <code>{d}</code>
                    </div>
                  );
                })}
            </div>
            <div>
              <strong>Tip:</strong> Use a subquery inside an <code>IN</code> or{" "}
              <code>NOT IN</code> clause for more advanced filtering.
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default AnalysisForm;
