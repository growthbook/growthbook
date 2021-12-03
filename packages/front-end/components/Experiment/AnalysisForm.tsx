import { FC } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";
import { getValidDate } from "../../services/dates";
import Select from "../Forms/Select";

const AnalysisForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  phase: number;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate, phase }) => {
  const { metrics, segments, getDatasourceById } = useDefinitions();

  const filteredMetrics = metrics.filter(
    (m) => m.datasource === experiment.datasource
  );
  const filteredSegments = segments.filter(
    (s) => s.datasource === experiment.datasource
  );

  const datasource = getDatasourceById(experiment.datasource);
  const datasourceProperties = datasource?.properties;

  const phaseObj = experiment.phases[phase];

  const form = useForm({
    defaultValues: {
      userIdType: experiment.userIdType || "anonymous",
      trackingKey: experiment.trackingKey || "",
      activationMetric: experiment.activationMetric || "",
      segment: experiment.segment || "",
      queryFilter: experiment.queryFilter || "",
      skipPartialData: experiment.skipPartialData ? "strict" : "loose",
      dateStarted: getValidDate(phaseObj?.dateStarted)
        .toISOString()
        .substr(0, 16),
      dateEnded: getValidDate(phaseObj?.dateEnded).toISOString().substr(0, 16),
      variations: experiment.variations || [],
    },
  });
  const { apiCall } = useAuth();

  const variations = useFieldArray({
    control: form.control,
    name: "variations",
  });

  return (
    <Modal
      header={"Configure Experiment Analysis"}
      open={true}
      close={cancel}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        const { dateStarted, dateEnded, skipPartialData, ...values } = value;

        const body: Partial<ExperimentInterfaceStringDates> & {
          phaseStartDate: string;
          phaseEndDate?: string;
          currentPhase?: number;
        } = {
          ...values,
          currentPhase: phase,
          phaseStartDate: dateStarted,
          skipPartialData: skipPartialData === "strict",
        };

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
      <Field
        label="Data Source"
        labelClassName="font-weight-bold"
        value={datasource?.name || "Manual"}
        disabled
        helpText="You must revert this experiment to a draft to change the data source"
      />
      <Field
        label="Experiment Id"
        labelClassName="font-weight-bold"
        {...form.register("trackingKey")}
        helpText="Will match against the experiment_id column in your data source"
      />
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
      {datasource?.properties?.userIds && (
        <Field
          label="User Id Column"
          labelClassName="font-weight-bold"
          {...form.register("userIdType")}
          options={[
            {
              display: "user_id",
              value: "user",
            },
            {
              display: "anonymous_id",
              value: "anonymous",
            },
          ]}
          helpText="Determines how we define a single 'user' in the analysis"
        />
      )}
      {phaseObj && (
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
      <Select
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
        <Field
          label="Segment"
          labelClassName="font-weight-bold"
          {...form.register("segment")}
          initialOption="None (All Users)"
          options={filteredSegments.map((s) => {
            return {
              display: s.name,
              value: s.id,
            };
          })}
          helpText="Only users in this segment will be included"
        />
      )}
      {datasourceProperties?.separateExperimentResultQueries && (
        <Field
          label="Metric Conversion Windows"
          labelClassName="font-weight-bold"
          {...form.register("skipPartialData")}
          options={[
            {
              display: "Include In-Progress Conversions",
              value: "loose",
            },
            {
              display: "Exclude In-Progress Conversions",
              value: "strict",
            },
          ]}
          helpText="How to treat users who have not had the full time to convert yet"
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
              {["user_id", "anonymous_id", "timestamp", "variation_id"]
                .concat(datasource?.settings?.experimentDimensions || [])
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
