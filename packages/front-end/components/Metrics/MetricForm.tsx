import { FC, useState } from "react";
import { MetricInterface, Condition, MetricType } from "back-end/types/metric";
import { useAuth } from "../../services/auth";
import useDatasources from "../../hooks/useDatasources";
import useForm from "../../hooks/useForm";
import GoogleAnalyticsMetrics from "./GoogleAnalyticsMetrics";
import RadioSelector from "../Forms/RadioSelector";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import track from "../../services/track";

const weekAgo = new Date();
weekAgo.setDate(weekAgo.getDate() - 7);

export type MetricFormProps = {
  initialStep?: number;
  current: Partial<MetricInterface>;
  edit: boolean;
  onClose: (refresh?: boolean) => void;
};

const MetricForm: FC<MetricFormProps> = ({
  current,
  edit,
  onClose,
  initialStep = 0,
}) => {
  const { datasources, getById } = useDatasources();
  const [step, setStep] = useState(initialStep);

  const metricTypeOptions = [
    {
      key: "binomial",
      display: "Binomial",
      description: "Percent of users who do something",
      sub: "click, view, download, bounce, etc.",
      tooltip: "Uses Bayesian statistics for analysis",
    },
    {
      key: "count",
      display: "Count",
      description: "Number of actions per user",
      sub: "clicks, views, downloads, etc.",
      tooltip: "Uses Bayesian statistics for analysis",
    },
    {
      key: "duration",
      display: "Duration",
      description: "How long something takes",
      sub: "time on site, loading speed, etc.",
      tooltip: "Uses bootstrapping for analysis",
    },
    {
      key: "revenue",
      display: "Revenue",
      description: "How much money a user pays (in USD)",
      sub: "revenue per visitor, average order value, etc.",
      tooltip: "Uses bootstrapping for analysis",
    },
  ];

  const [value, inputs, manualUpdate] = useForm(
    {
      datasource:
        ("datasource" in current ? current.datasource : datasources[0]?.id) ||
        "",
      name: current.name || "",
      type: current.type || "binomial",
      table: current.table || "",
      column: current.column || "",
      earlyStart: !!current.earlyStart,
      inverse: !!current.inverse,
      ignoreNulls: !!current.ignoreNulls,
      cap: current.cap || 0,
      conditions: current.conditions || [],
      userIdColumn: current.userIdColumn || "",
      anonymousIdColumn: current.anonymousIdColumn || "",
      userIdType: current.userIdType || "either",
      timestampColumn: current.timestampColumn || "",
    },
    current.id || "new"
  );

  const { apiCall } = useAuth();

  const currentDataSource = getById(value.datasource);

  const datasourceType = currentDataSource?.type;

  const datasourceSettingsSupport =
    !!currentDataSource && !["google_analytics"].includes(datasourceType);

  const conditionsSupported = !["google_analytics"].includes(datasourceType);
  const capSupported = !["google_analytics"].includes(datasourceType);

  const supportsSQL =
    datasourceSettingsSupport && !["mixpanel"].includes(datasourceType);

  const customzeTimestamp = supportsSQL;
  const customizeUserIds = supportsSQL;

  let table = "Table";
  let column = "Column";
  if (datasourceType === "mixpanel") {
    table = "Event";
    column = "Property";
  }

  const addCondition = () => {
    manualUpdate({
      conditions: [
        ...value.conditions,
        {
          column: "",
          operator: "=",
          value: "",
        },
      ],
    });
  };
  const deleteCondition = (i: number) => {
    const clone = [...value.conditions];
    clone.splice(i, 1);
    manualUpdate({ conditions: clone });
  };

  const onSubmit = async () => {
    // Require a metric name
    if (value.name.length < 1) {
      setStep(0);
      throw new Error("Metric name is required.");
    }
    // If the data source supports queries, require a table name at least
    if (datasourceSettingsSupport && value.table.length < 1) {
      setStep(1);
      throw new Error("Table name is required.");
    }

    const body = JSON.stringify({
      ...value,
    });

    if (edit) {
      await apiCall(`/metric/${current.id}`, {
        method: "PUT",
        body,
      });
    } else {
      await apiCall(`/metrics`, {
        method: "POST",
        body,
      });

      track("Create Metric", {
        type: value.type,
        userIdType: value.userIdType,
      });
    }
    onClose(true);
  };

  const sqlPreviewData = {
    userIdCol: "",
    timestampCol:
      value.timestampColumn ||
      currentDataSource?.settings?.default?.timestampColumn ||
      "received_at",
    weekAgo: weekAgo.toISOString().substr(0, 10),
    column: "",
    where: value.conditions
      .map((c: Condition) => {
        return (
          "  AND " + (c.column || "?") + " " + c.operator + " '" + c.value + "'"
        );
      })
      .join("\n"),
  };
  if (value.userIdType === "user") {
    sqlPreviewData.userIdCol =
      value.userIdColumn ||
      currentDataSource?.settings?.default?.userIdColumn ||
      "user_id";
  } else if (value.userIdType === "anonymous") {
    sqlPreviewData.userIdCol =
      value.anonymousIdColumn ||
      currentDataSource?.settings?.default?.anonymousIdColumn ||
      "anonymous_id";
  } else {
    sqlPreviewData.userIdCol =
      (value.userIdColumn ||
        currentDataSource?.settings?.default?.userIdColumn ||
        "user_id") +
      " /*or " +
      (value.anonymousIdColumn ||
        currentDataSource?.settings?.default?.anonymousIdColumn ||
        "anonymous_id") +
      "*/";
  }

  if (value.type === "count") {
    if (!value.column || value.column === "*") {
      sqlPreviewData.column = "COUNT(*) as count";
    } else {
      sqlPreviewData.column =
        "COUNT(\n    DISTINCT " + (value.column || "?") + "\n  ) as count";
    }
  } else if (value.type === "duration") {
    sqlPreviewData.column =
      "MAX(\n    " + (value.column || "?") + "\n  ) as duration";
  } else if (value.type === "revenue") {
    sqlPreviewData.column =
      "MAX(\n    " + (value.column || "?") + "\n  ) as revenue";
  }
  if (sqlPreviewData.column) {
    sqlPreviewData.column =
      ",\n  " + sqlPreviewData.column.replace(/\{\s*alias\s*\}\./g, "");
  }

  return (
    <PagedModal
      header={edit ? "Edit Metric" : "New Metric"}
      close={() => onClose(false)}
      submit={onSubmit}
      cta="Save"
      closeCta="Cancel"
      size="lg"
      step={step}
      setStep={setStep}
    >
      <Page display="Basic Info">
        <div className="form-group">
          Metric Name
          <input
            type="text"
            required
            className="form-control"
            {...inputs.name}
          />
        </div>
        <div className="form-group">
          Data Source
          <select
            {...inputs.datasource}
            name="datasource"
            className="form-control"
            disabled={!!current.id}
          >
            {(datasources || []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value="">Manual</option>
          </select>
        </div>
        <div className="form-group">
          Metric Type
          <RadioSelector
            name="metricType"
            value={value.type}
            setValue={(type) => {
              manualUpdate({
                type: type as MetricType,
              });
            }}
            options={metricTypeOptions}
          />
        </div>
        {value.datasource && datasourceType === "google_analytics" && (
          <GoogleAnalyticsMetrics inputProps={inputs.table} type={value.type} />
        )}
      </Page>
      <Page display="Query Settings" enabled={datasourceSettingsSupport}>
        <div className="row">
          <div className="col-lg">
            {["count", "duration", "revenue"].includes(value.type) && (
              <div className="form-group ">
                {value.type === "count"
                  ? `Distinct ${column} for Counting`
                  : column}
                <input
                  type="text"
                  required={value.type !== "count"}
                  className="form-control"
                  {...inputs.column}
                />
              </div>
            )}
            <div className="form-group">
              {table} Name
              <input
                type="text"
                required
                className="form-control"
                {...inputs.table}
              />
            </div>
            {conditionsSupported && (
              <div className="mb-3">
                {value.conditions.length > 0 && <h6>Conditions</h6>}
                {value.conditions.map((cond: Condition, i) => (
                  <div
                    className="form-row border py-2 mb-2 align-items-center"
                    key={i}
                  >
                    {i > 0 && <div className="col-auto">AND</div>}
                    <div className="col-auto">
                      <input
                        required
                        className="form-control mb-1"
                        placeholder={column}
                        {...inputs.conditions[i].column}
                      />
                    </div>
                    <div className="col-auto">
                      <select
                        className="form-control"
                        {...inputs.conditions[i].operator}
                      >
                        <option value="=">=</option>
                        <option value="!=">!=</option>
                        <option value="~">~</option>
                        <option value="!~">!~</option>
                        <option value="<">&lt;</option>
                        <option value=">">&gt;</option>
                        <option value="<=">&lt;=</option>
                        <option value=">=">&gt;=</option>
                      </select>
                    </div>
                    <div className="col-auto">
                      <input
                        required
                        className="form-control"
                        placeholder="Value"
                        {...inputs.conditions[i].value}
                      />
                    </div>
                    <div className="col-auto">
                      <button
                        className="btn btn-danger"
                        onClick={(e) => {
                          e.preventDefault();
                          deleteCondition(i);
                        }}
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  className="btn btn-outline-success"
                  onClick={(e) => {
                    e.preventDefault();
                    addCondition();
                  }}
                >
                  Add Condition
                </button>
              </div>
            )}
            {customzeTimestamp && (
              <div className="form-group ">
                Timestamp Column
                <input
                  type="text"
                  placeholder={
                    currentDataSource?.settings?.default?.timestampColumn ||
                    "received_at"
                  }
                  className="form-control"
                  {...inputs.timestampColumn}
                />
              </div>
            )}
            {customizeUserIds && (
              <div className="form-group">
                User Types Supported
                <select className="form-control" {...inputs.userIdType}>
                  <option value="anonymous">Anonymous Only</option>
                  <option value="user">Users Only</option>
                  <option value="either">Both Anonymous and Users</option>
                </select>
              </div>
            )}
            {value.userIdType !== "anonymous" && customizeUserIds && (
              <div className="form-group ">
                User Id Column
                <input
                  type="text"
                  placeholder={
                    currentDataSource?.settings?.default?.userIdColumn ||
                    "user_id"
                  }
                  className="form-control"
                  {...inputs.userIdColumn}
                />
              </div>
            )}
            {value.userIdType !== "user" && customizeUserIds && (
              <div className="form-group ">
                Anonymous Id Column
                <input
                  type="text"
                  placeholder={
                    currentDataSource?.settings?.default?.anonymousIdColumn ||
                    "anonymous_id"
                  }
                  className="form-control"
                  {...inputs.anonymousIdColumn}
                />
              </div>
            )}
          </div>
          {supportsSQL && (
            <div className="col-lg">
              Query Preview:
              <pre className="bg-dark text-light p-2">
                {`SELECT
  ${sqlPreviewData.userIdCol}${sqlPreviewData.column}
FROM
  ${value.table || "?"}
WHERE
  ${sqlPreviewData.timestampCol} > '${sqlPreviewData.weekAgo}'${
                  sqlPreviewData.where ? "\n" + sqlPreviewData.where : ""
                }
GROUP BY
  ${sqlPreviewData.userIdCol}`}
              </pre>
            </div>
          )}
        </div>
      </Page>
      <Page display="Behavior">
        <div className="form-group ">
          What is the Goal?
          <select required className="form-control" {...inputs.inverse}>
            <option value="false">
              Increase the{" "}
              {value.type === "binomial" ? "conversion rate" : value.type}
            </option>
            <option value="true">
              Decrease the{" "}
              {value.type === "binomial" ? "conversion rate" : value.type}
            </option>
          </select>
        </div>
        {capSupported && ["count", "duration", "revenue"].includes(value.type) && (
          <div className="form-group">
            Capped Value
            <input type="number" className="form-control" {...inputs.cap} />
            <small className="text-muted">
              If greater than zero, any user who has more than this count will
              be capped at this value.
            </small>
          </div>
        )}
        {capSupported && ["duration", "revenue"].includes(value.type) && (
          <div className="form-group">
            Converted Users Only
            <select className="form-control" {...inputs.ignoreNulls}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
            <small className="text-muted">
              If yes, exclude anyone with a metric value less than or equal to
              zero from analysis.
            </small>
          </div>
        )}
        {capSupported && (
          <div className="form-group">
            In an Experiment,{" "}
            {value.type === "binomial"
              ? "only count if a conversion happens"
              : "start counting"}
            <select required className="form-control" {...inputs.earlyStart}>
              <option value="false">
                After the user is assigned a variation
              </option>
              <option value="true">
                {value.type === "binomial"
                  ? "Any time during the"
                  : "At the start of the"}{" "}
                user&apos;s session
              </option>
            </select>
          </div>
        )}
      </Page>
    </PagedModal>
  );
};

export default MetricForm;
