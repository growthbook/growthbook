import { useFieldArray, useForm } from "react-hook-form";
import {
  ExperimentReportArgs,
  ReportInterface,
} from "../../../back-end/types/report";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import MetricsSelector from "../Experiment/MetricsSelector";
import Field from "../Forms/Field";
import Modal from "../Modal";

export default function ConfigureReport({
  report,
  mutate,
  viewResults,
}: {
  report: ReportInterface;
  mutate: () => void;
  viewResults: () => void;
}) {
  const { apiCall } = useAuth();
  const form = useForm({
    defaultValues: report.args,
  });

  const { metrics, segments, dimensions, getDatasourceById } = useDefinitions();

  const filteredMetrics = metrics.filter(
    (m) => m.datasource === report.args.datasource
  );
  const filteredSegments = segments.filter(
    (s) => s.datasource === report.args.datasource
  );
  const filteredDimensions = dimensions
    .filter((d) => d.datasource === report.args.datasource)
    .map((d) => {
      return {
        display: d.name,
        value: d.id,
      };
    });

  const datasource = getDatasourceById(report.args.datasource);
  const datasourceProperties = datasource?.properties;
  const supportsSql = datasource?.properties?.queryLanguage === "sql";

  const variations = useFieldArray({
    control: form.control,
    name: "variations",
  });

  return (
    <Modal
      inline={true}
      header=""
      size="fill"
      open={true}
      submit={form.handleSubmit(async (value) => {
        const args: ExperimentReportArgs = {
          ...value,
          skipPartialData: !!value.skipPartialData,
        };

        await apiCall(`/report/${report.id}`, {
          method: "PUT",
          body: JSON.stringify({
            args,
          }),
        });
        mutate();
        viewResults();
      })}
      cta="Save and Run"
    >
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
                {...form.register(`variations.${i}.id`)}
                placeholder={i + ""}
              />
            </div>
          ))}
        </div>
        <small className="form-text text-muted">
          Will match against the variation_id column in your data source
        </small>
      </div>
      <div className="form-group">
        <label className="font-weight-bold">Variation Weights</label>
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
                {...form.register(`variations.${i}.weight`, {
                  valueAsNumber: true,
                })}
              />
            </div>
          ))}
        </div>
        <small className="form-text text-muted">
          Will use this to check for a Sample Ratio Mismatch (SRM) in the
          results
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

      <div className="row">
        <div className="col">
          <Field
            label="Start Date (UTC)"
            labelClassName="font-weight-bold"
            type="datetime-local"
            {...form.register("startDate")}
            helpText="Only include users who entered the experiment on or after this date"
          />
        </div>
        <div className="col">
          <Field
            label="End Date (UTC)"
            labelClassName="font-weight-bold"
            type="datetime-local"
            {...form.register("endDate")}
            helpText="Only include users who entered the experiment on or before this date"
          />
        </div>
      </div>

      <div className="form-group">
        <label className="font-weight-bold mb-1">Goal Metrics</label>
        <div className="mb-1 font-italic">
          Metrics you are trying to improve with this experiment.
        </div>
        <MetricsSelector
          selected={form.watch("metrics")}
          onChange={(metrics) => form.setValue("metrics", metrics)}
          datasource={report.args.datasource}
        />
      </div>
      <div className="form-group">
        <label className="font-weight-bold mb-1">Guardrail Metrics</label>
        <div className="mb-1 font-italic">
          Metrics you want to monitor, but are NOT specifically trying to
          improve.
        </div>
        <MetricsSelector
          selected={form.watch("guardrails")}
          onChange={(metrics) => form.setValue("guardrails", metrics)}
          datasource={report.args.datasource}
        />
      </div>
      {(filteredDimensions.length > 0 || supportsSql) && (
        <div className="col-auto form-inline">
          <label className="mr-2">Dimension</label>{" "}
          <select
            className="form-control"
            value={form.watch("dimension")}
            onChange={(e) => {
              form.setValue("dimension", e.target.value);
            }}
          >
            <option value="">None</option>
            {supportsSql && (
              <optgroup label="Built-in">
                <option value="pre:date">Date</option>
                {datasource?.properties?.activationDimension &&
                  report.args.activationMetric && (
                    <option value="pre:activation">Activation Status</option>
                  )}
              </optgroup>
            )}
            {filteredDimensions.length > 0 && (
              <optgroup label="Custom">
                {filteredDimensions.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.display}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <small className="form-text text-muted">
            Break down results for each metric by a dimension
          </small>
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
      {datasourceProperties?.separateExperimentResultQueries && (
        <Field
          label="Metric Conversion Windows"
          labelClassName="font-weight-bold"
          {...form.register("skipPartialData")}
          options={[
            {
              display: "Include In-Progress Conversions",
              value: false,
            },
            {
              display: "Exclude In-Progress Conversions",
              value: true,
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
}
