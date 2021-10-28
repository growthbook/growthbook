import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";

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

  let defaultDateStarted = new Date(phaseObj?.dateStarted || Date.now());
  // check for a valid date:
  if (!+defaultDateStarted) {
    defaultDateStarted = new Date();
  }
  let defaultDateEnded = new Date(phaseObj?.dateEnded || Date.now());
  // check for a valid date:
  if (!+defaultDateEnded) {
    defaultDateEnded = new Date();
  }

  const form = useForm({
    defaultValues: {
      userIdType: experiment.userIdType || "anonymous",
      trackingKey: experiment.trackingKey || "",
      activationMetric: experiment.activationMetric || "",
      segment: experiment.segment || "",
      queryFilter: experiment.queryFilter || "",
      dateStarted: defaultDateStarted.toISOString().substr(0, 16),
      dateEnded: defaultDateEnded.toISOString().substr(0, 16),
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      header={"Configure Experiment Analysis"}
      open={true}
      close={cancel}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        const { dateStarted, dateEnded, ...values } = value;

        const body: Partial<ExperimentInterfaceStringDates> & {
          phaseStartDate: string;
          phaseEndDate?: string;
          currentPhase?: number;
        } = {
          ...values,
          currentPhase: phase,
          phaseStartDate: dateStarted,
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
      <Field
        label="Activation Metric"
        labelClassName="font-weight-bold"
        {...form.register("activationMetric")}
        options={filteredMetrics.map((m) => {
          return {
            display: m.name,
            value: m.id,
          };
        })}
        initialOption="None"
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
