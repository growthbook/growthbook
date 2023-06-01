import { ago } from "@/../shared/dates";
import { cloneDeep } from "lodash";
import { useState } from "react";
import Tooltip from "../Tooltip/Tooltip";
import Toggle from "../Forms/Toggle";
import Button from "../Button";
import SQLInputField from "../SQLInputField";

type Props = {
  metric: {
    event: string;
    hasUserId: boolean;
    createBinomialFromEvent: boolean;
    createCountFromEvent: boolean;
    displayName: string;
    lastTrackedAt: Date;
    count: number;
    binomialSqlQuery: string;
    countSqlQuery: string;
    countDisplayName: string;
  };
  setMetricsToCreate: (
    metrics: {
      event: string;
      hasUserId: boolean;
      createBinomialFromEvent: boolean;
      createCountFromEvent: boolean;
      displayName: string;
      lastTrackedAt: Date;
      count: number;
      binomialSqlQuery: string;
      countSqlQuery: string;
      countDisplayName: string;
    }[]
  ) => void;
  metricsToCreate: {
    event: string;
    hasUserId: boolean;
    createBinomialFromEvent: boolean;
    createCountFromEvent: boolean;
    displayName: string;
    lastTrackedAt: Date;
    count: number;
    binomialSqlQuery: string;
    countSqlQuery: string;
    countDisplayName: string;
  }[];
  dataSourceId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  i: number;
};

export default function AutoMetricCard({
  metric,
  setMetricsToCreate,
  metricsToCreate,
  dataSourceId,
  form,
  i,
}: Props) {
  const [showSqlPreview, setShowSqlPreview] = useState<string>("");

  const handleSqlPreview = async (sql: string) => {
    if (!showSqlPreview || showSqlPreview !== sql) {
      setShowSqlPreview(sql);
    } else {
      setShowSqlPreview("");
    }
  };

  return (
    <>
      <tr key={`${metric}-${i}`}>
        <td>{metric.displayName}</td>
        <td>
          <Tooltip
            className="d-flex align-items-center justify-content-center"
            body={`Last tracked ${ago(metric.lastTrackedAt)}`}
          >
            {metric.count}
          </Tooltip>
        </td>
        <td>
          <div className="d-flex flex-column justify-content-center align-items-center">
            <Toggle
              value={metric.createBinomialFromEvent}
              id={`${metric}-${i}-binomial`}
              setValue={(value) => {
                const newMetricsToCreate = cloneDeep(metricsToCreate);
                newMetricsToCreate[i].createBinomialFromEvent = value;
                setMetricsToCreate(newMetricsToCreate);
              }}
            />
            <Button
              color="link"
              onClick={async () => handleSqlPreview(metric.binomialSqlQuery)}
            >
              {showSqlPreview && showSqlPreview === metric.binomialSqlQuery
                ? "Hide SQL"
                : "Preview SQL"}
            </Button>
          </div>
        </td>
        <td>
          <div className="d-flex flex-column justify-content-center align-items-center">
            <Toggle
              value={metric.createCountFromEvent}
              id={`${metric}-${i}-count`}
              setValue={(value) => {
                const newMetricsToCreate = cloneDeep(metricsToCreate);
                newMetricsToCreate[i].createCountFromEvent = value;
                setMetricsToCreate(newMetricsToCreate);
              }}
            />
            <Button
              color="link"
              onClick={async () => handleSqlPreview(metric.countSqlQuery)}
            >
              {showSqlPreview && showSqlPreview === metric.countSqlQuery
                ? "Hide SQL"
                : "Preview SQL"}
            </Button>
          </div>
        </td>
      </tr>
      {showSqlPreview && (
        <tr>
          <td colSpan={4}>
            <SQLInputField
              userEnteredQuery={showSqlPreview}
              datasourceId={dataSourceId}
              form={form}
              requiredColumns={new Set()}
              queryType="metric"
            />
          </td>
        </tr>
      )}
    </>
  );
}
