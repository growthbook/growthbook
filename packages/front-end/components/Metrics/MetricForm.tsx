import { FC, useState } from "react";
import { MetricInterface, Condition, MetricType } from "back-end/types/metric";
import { useAuth } from "../../services/auth";
import useForm from "../../hooks/useForm";
import GoogleAnalyticsMetrics from "./GoogleAnalyticsMetrics";
import RadioSelector from "../Forms/RadioSelector";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import track from "../../services/track";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useEffect } from "react";
import Code from "../Code";
import TagsInput from "../TagsInput";
import { getDefaultConversionWindowHours } from "../../services/env";
import {
  defaultLoseRiskThreshold,
  defaultWinRiskThreshold,
} from "../../services/metrics";

const weekAgo = new Date();
weekAgo.setDate(weekAgo.getDate() - 7);

export type MetricFormProps = {
  initialStep?: number;
  current: Partial<MetricInterface>;
  edit: boolean;
  source: string;
  onClose: (refresh?: boolean) => void;
};

function validateSQL(
  sql: string,
  type: MetricType,
  userIdType: "user" | "anonymous" | "either"
) {
  if (!sql.length) {
    throw new Error("SQL cannot be empty");
  }

  // require a SELECT statement
  if (!sql.match(/SELECT\s[\s\S]*\sFROM\s[\S\s]+/i)) {
    throw new Error("Invalid SQL. Expecting `SELECT ... FROM ...`");
  }
  if (!sql.match(/timestamp/i)) {
    throw new Error("Must select a `timestamp` column.");
  }
  if (type !== "binomial" && !sql.match(/value/i)) {
    throw new Error("Must select a `value` column.");
  }
  if (userIdType !== "user" && !sql.match(/anonymous_id/i)) {
    throw new Error("Must select an `anonymous_id` column.");
  }
  if (userIdType !== "anonymous" && !sql.match(/user_id/i)) {
    throw new Error("Must select a `user_id` column.");
  }
}
function validateBasicInfo(value: Partial<MetricInterface>) {
  if (value.name.length < 1) {
    throw new Error("Metric name cannot be empty");
  }
}
function validateQuerySettings(
  datasourceSettingsSupport: boolean,
  sqlInput: boolean,
  value: Partial<MetricInterface>
) {
  if (!datasourceSettingsSupport) {
    return;
  }
  if (sqlInput) {
    validateSQL(value.sql, value.type, value.userIdType);
  } else {
    if (value.table.length < 1) {
      throw new Error("Table name cannot be empty");
    }
  }
}

const MetricForm: FC<MetricFormProps> = ({
  current,
  edit,
  onClose,
  source,
  initialStep = 0,
}) => {
  const { datasources, getDatasourceById, refreshTags } = useDefinitions();
  const [step, setStep] = useState(initialStep);
  const [sqlInput, setSqlInput] = useState(
    current?.sql || !current?.table ? true : false
  );

  useEffect(() => {
    track("View Metric Form", {
      source,
    });
  }, [source]);

  const metricTypeOptions = [
    {
      key: "binomial",
      display: "Binomial",
      description: "Percent of users who do something",
      sub: "click, view, download, bounce, etc.",
    },
    {
      key: "count",
      display: "Count",
      description: "Number of actions per user",
      sub: "clicks, views, downloads, etc.",
    },
    {
      key: "duration",
      display: "Duration",
      description: "How long something takes",
      sub: "time on site, loading speed, etc.",
    },
    {
      key: "revenue",
      display: "Revenue",
      description: "How much money a user pays (in USD)",
      sub: "revenue per visitor, average order value, etc.",
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
      conversionWindowHours:
        current.conversionWindowHours || getDefaultConversionWindowHours(),
      sql: current.sql || "",
      conditions: current.conditions || [],
      userIdColumn: current.userIdColumn || "",
      anonymousIdColumn: current.anonymousIdColumn || "",
      userIdType: current.userIdType || "either",
      timestampColumn: current.timestampColumn || "",
      tags: current.tags || [],
      winRisk: current.winRisk || defaultWinRiskThreshold * 100,
      loseRisk: current.loseRisk || defaultLoseRiskThreshold * 100,
    },
    current.id || "new"
  );

  const { apiCall } = useAuth();

  const currentDataSource = getDatasourceById(value.datasource);

  const datasourceType = currentDataSource?.type;

  const datasourceSettingsSupport =
    !!currentDataSource && !["google_analytics"].includes(datasourceType);

  const conditionsSupported = !["google_analytics"].includes(datasourceType);
  const capSupported =
    datasourceType && !["google_analytics"].includes(datasourceType);

  const ignoreNullsSupported = !["google_analytics"].includes(datasourceType);

  const conversionWindowSupported =
    !!currentDataSource && !["google_analytics"].includes(datasourceType);

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
    const sendValue = { ...value };
    //correct decimal/percent:
    if (sendValue?.winRisk) sendValue.winRisk = sendValue.winRisk / 100;
    if (sendValue?.loseRisk) sendValue.loseRisk = sendValue.loseRisk / 100;

    if (value.loseRisk < value.winRisk) return;

    const body = JSON.stringify({
      sendValue,
      sql: sqlInput ? value.sql : "",
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
    }

    track("Submit Metric Form", {
      type: value.type,
      source,
      userIdType: value.userIdType,
    });

    onClose(true);
  };

  const sqlPreviewData = {
    userIdCol: "",
    timestampCol: value.timestampColumn || "received_at",
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
    sqlPreviewData.userIdCol = value.userIdColumn || "user_id";
  } else if (value.userIdType === "anonymous") {
    sqlPreviewData.userIdCol = value.anonymousIdColumn || "anonymous_id";
  } else {
    sqlPreviewData.userIdCol =
      (value.userIdColumn || "user_id") +
      " /*or " +
      (value.anonymousIdColumn || "anonymous_id") +
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

  const riskError =
    value.loseRisk < value.winRisk
      ? "The acceptable risk percentage cannot be higher than the too risky percentage"
      : "";

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
      <Page
        display="Basic Info"
        validate={async () => validateBasicInfo(value)}
      >
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
          Tags
          <TagsInput
            value={value.tags}
            onChange={(tags) => {
              refreshTags(tags);
              manualUpdate({ tags });
            }}
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
      <Page
        display="Query Settings"
        enabled={datasourceSettingsSupport}
        validate={async () => {
          validateQuerySettings(
            datasourceSettingsSupport,
            supportsSQL && sqlInput,
            value
          );
        }}
      >
        {supportsSQL && (
          <div className="form-group bg-light border px-3 py-2">
            <div className="form-check form-check-inline">
              <input
                className="form-check-input"
                type="radio"
                name="input-mode"
                value="sql"
                id="sql-input-mode"
                checked={sqlInput}
                onChange={(e) => setSqlInput(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="sql-input-mode">
                SQL
              </label>
            </div>
            <div className="form-check form-check-inline">
              <input
                className="form-check-input"
                type="radio"
                name="input-mode"
                value="builder"
                id="query-builder-input-mode"
                checked={!sqlInput}
                onChange={(e) => setSqlInput(!e.target.checked)}
              />
              <label
                className="form-check-label"
                htmlFor="query-builder-input-mode"
              >
                Query Builder
              </label>
            </div>
          </div>
        )}
        <div className="row">
          <div className="col-lg">
            {supportsSQL && sqlInput ? (
              <div>
                <div className="form-group">
                  <div className="form-group">
                    <label>User Types Supported</label>
                    <select className="form-control" {...inputs.userIdType}>
                      <option value="anonymous">Anonymous Only</option>
                      <option value="user">Users Only</option>
                      <option value="either">Both Anonymous and Users</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>SQL</label>
                  <textarea
                    {...inputs.sql}
                    className="form-control"
                    rows={15}
                    placeholder="SELECT ..."
                    autoFocus
                    required
                    minLength={15}
                  />
                </div>
              </div>
            ) : (
              <>
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
                      placeholder={"received_at"}
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
                      placeholder={"user_id"}
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
                      placeholder={"anonymous_id"}
                      className="form-control"
                      {...inputs.anonymousIdColumn}
                    />
                  </div>
                )}
              </>
            )}
          </div>
          {supportsSQL && (
            <div className="col-lg bg-light border-left pt-2">
              {sqlInput ? (
                <div>
                  Example SQL
                  <Code
                    language="sql"
                    code={`SELECT
${value.userIdType !== "anonymous" ? `  ${"user_id"} as user_id,\n` : ""}${
                      value.userIdType !== "user"
                        ? `  ${"anonymous_id"} as anonymous_id,\n`
                        : ""
                    }${
                      value.type === "binomial"
                        ? ""
                        : value.type === "count"
                        ? "  1 as value,\n"
                        : value.type === "revenue"
                        ? "  amount as value,\n"
                        : "  duration as value,\n"
                    }  ${"received_at"} as timestamp
FROM
  ${
    value.type === "binomial" || value.type === "count"
      ? "downloads"
      : value.type === "revenue"
      ? "purchases"
      : "sessions"
  }`}
                  />
                  <p className="mt-3">
                    Your SELECT statement must return the following columns:
                  </p>
                  <ol>
                    {value.userIdType !== "anonymous" && (
                      <li>
                        <strong>user_id</strong> - The logged-in user id of the
                        person converting
                      </li>
                    )}
                    {value.userIdType !== "user" && (
                      <li>
                        <strong>anonymous_id</strong> - The anonymous id of the
                        person converting
                      </li>
                    )}
                    {value.type !== "binomial" && (
                      <li>
                        <strong>value</strong> -{" "}
                        {value.type === "count"
                          ? "The number of conversions (multiple rows for a user will be summed)"
                          : "The " +
                            value.type +
                            " amount (multiple rows for a user will be summed)"}
                      </li>
                    )}
                    <li>
                      <strong>timestamp</strong> - When the action was performed
                    </li>
                  </ol>
                </div>
              ) : (
                <>
                  Query Preview:
                  <Code
                    language="sql"
                    code={`SELECT
  ${sqlPreviewData.userIdCol}${sqlPreviewData.column}
FROM
  ${value.table || "?"}
WHERE
  ${sqlPreviewData.timestampCol} > '${sqlPreviewData.weekAgo}'${
                      sqlPreviewData.where ? "\n" + sqlPreviewData.where : ""
                    }
GROUP BY
  ${sqlPreviewData.userIdCol}`}
                  />
                </>
              )}
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
        {conversionWindowSupported && (
          <div className="form-group">
            Conversion Window (hours)
            <input
              type="number"
              step="1"
              min="1"
              className="form-control"
              placeholder={getDefaultConversionWindowHours()}
              {...inputs.conversionWindowHours}
            />
          </div>
        )}
        {ignoreNullsSupported && ["duration", "revenue"].includes(value.type) && (
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
        <div className="form-group">
          Risk thresholds
          <div className="riskbar row align-items-center pt-3">
            <div className="col green-bar pr-0">
              <span
                style={{
                  position: "absolute",
                  top: "-20px",
                  color: "#009a6d",
                  fontSize: "0.75rem",
                }}
              >
                acceptable risk under {value.winRisk}%
              </span>
              <div
                style={{
                  height: "10px",
                  backgroundColor: "#009a6d",
                  borderRadius: "5px 0 0 5px",
                }}
              ></div>
            </div>
            <div className="col-2 px-0">
              <span
                style={{
                  position: "absolute",
                  right: "4px",
                  top: "6px",
                  color: "#888",
                }}
              >
                %
              </span>
              <input
                className="form-control winrisk text-center"
                type="number"
                step="any"
                min="0"
                max="100"
                value={value.winRisk}
                onChange={(e) => {
                  let newRisk = parseFloat(e.target.value);
                  if (isNaN(newRisk)) newRisk = 0;
                  manualUpdate({ winRisk: newRisk });
                }}
              />
            </div>
            <div className="col yellow-bar px-0">
              <div
                style={{
                  height: "10px",
                  backgroundColor: "#dfd700",
                }}
              ></div>
            </div>
            <div className="col-2 px-0">
              <span
                style={{
                  position: "absolute",
                  right: "4px",
                  top: "6px",
                  color: "#888",
                }}
              >
                %
              </span>
              <input
                className="form-control loserisk text-center"
                type="number"
                step="any"
                min="0"
                max="100"
                value={value.loseRisk}
                onChange={(e) => {
                  let newRisk = parseFloat(e.target.value);
                  if (isNaN(newRisk)) newRisk = 0;
                  manualUpdate({ loseRisk: newRisk });
                }}
              />
            </div>
            <div className="col red-bar pl-0">
              <span
                style={{
                  position: "absolute",
                  top: "-20px",
                  right: "15px",
                  color: "#c50f0f",
                  fontSize: "0.75rem",
                }}
              >
                too much risk over {value.loseRisk}%
              </span>
              <div
                style={{
                  height: "10px",
                  backgroundColor: "#c50f0f",
                  borderRadius: "0 5px 5px 0",
                }}
              ></div>
            </div>
          </div>
          {riskError && <div className="text-danger">{riskError}</div>}
          <small className="text-muted">
            Set the threasholds for risk for this metric. This is used when
            determining metric signigicance, highlighting the risk value as
            green, yellow, or red.
          </small>
        </div>
      </Page>
    </PagedModal>
  );
};

export default MetricForm;
