import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";

const AnalysisForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const { metrics, segments, getDatasourceById } = useDefinitions();

  const filteredMetrics = metrics.filter(
    (m) => m.datasource === experiment.datasource
  );
  const filteredSegments = segments.filter(
    (s) => s.datasource === experiment.datasource
  );

  const datasource = getDatasourceById(experiment.datasource);
  const datasourceProperties = datasource?.properties;

  const form = useForm({
    defaultValues: {
      activationMetric: experiment.activationMetric || "",
      segment: experiment.segment || "",
      queryFilter: experiment.queryFilter || "",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      header={"Edit Analysis Settings"}
      open={true}
      close={cancel}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      cta="Save"
    >
      <p>These settings limit who is included in the experiment analysis.</p>
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
          <div className="pt-3 border-left col-sm-4 col-lg-6">
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
            <div>Subqueries are supported for more advanced filtering.</div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default AnalysisForm;
