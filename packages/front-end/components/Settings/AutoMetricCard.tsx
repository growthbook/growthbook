import { ago } from "@/../shared/dates";
import { cloneDeep } from "lodash";
import { useState } from "react";
import { TrackedEventData } from "@/../back-end/src/types/Integration";
import Tooltip from "../Tooltip/Tooltip";
import Toggle from "../Forms/Toggle";
import Button from "../Button";
import SQLInputField from "../SQLInputField";

type Props = {
  event: TrackedEventData;
  setTrackedEvents: (events: TrackedEventData[]) => void;
  trackedEvents: TrackedEventData[];
  dataSourceId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  i: number;
};

export default function AutoMetricCard({
  event,
  setTrackedEvents,
  trackedEvents,
  dataSourceId,
  form,
  i,
}: Props) {
  const [sqlPreview, setSqlPreview] = useState<string>("");

  const handleSqlPreview = async (sql: string) => {
    if (!sqlPreview || sqlPreview !== sql) {
      setSqlPreview(sql);
    } else {
      setSqlPreview("");
    }
  };

  const selected =
    sqlPreview && event.metricsToCreate.findIndex((s) => s.sql === sqlPreview);

  const binmomialIndex = event.metricsToCreate.findIndex(
    (metric) => metric.type === "binomial"
  );

  const countIndex = event.metricsToCreate.findIndex(
    (metric) => metric.type === "count"
  );

  return (
    <>
      <tr key={`${event}-${i}`}>
        <td>{event.displayName}</td>
        <td>
          <Tooltip
            className="d-flex align-items-center justify-content-center"
            body={`Last tracked ${ago(event.lastTrackedAt)}`}
          >
            {event.count}
          </Tooltip>
        </td>
        {event.metricsToCreate[binmomialIndex]?.sql ? (
          <td className={selected === binmomialIndex ? "bg-light" : ""}>
            <div className="d-flex flex-column justify-content-center align-items-center">
              <Toggle
                value={
                  event.metricsToCreate[binmomialIndex].shouldCreate || false
                }
                id={`${event}-${event.metricsToCreate[binmomialIndex].name}`}
                setValue={(value) => {
                  const updatedTrackedEvents = cloneDeep(trackedEvents);
                  updatedTrackedEvents[i].metricsToCreate[
                    binmomialIndex
                  ].shouldCreate = value;
                  setTrackedEvents(updatedTrackedEvents);
                }}
              />
              <Button
                color="link"
                onClick={async () =>
                  handleSqlPreview(event.metricsToCreate[binmomialIndex].sql)
                }
              >
                {selected === binmomialIndex ? "Hide SQL" : "Preview SQL"}
              </Button>
            </div>
          </td>
        ) : (
          <td>
            <div className="text-center">-</div>
          </td>
        )}
        {event.metricsToCreate[countIndex]?.sql ? (
          <td className={selected === countIndex ? "bg-light" : ""}>
            <div className="d-flex flex-column justify-content-center align-items-center">
              <Toggle
                value={event.metricsToCreate[countIndex].shouldCreate || false}
                id={`${event}-${event.metricsToCreate[countIndex].name}`}
                setValue={(value) => {
                  const updatedTrackedEvents = cloneDeep(trackedEvents);
                  updatedTrackedEvents[i].metricsToCreate[
                    countIndex
                  ].shouldCreate = value;
                  setTrackedEvents(updatedTrackedEvents);
                }}
              />
              <Button
                color="link"
                onClick={async () =>
                  handleSqlPreview(event.metricsToCreate[countIndex].sql)
                }
              >
                {selected === countIndex ? "Hide SQL" : "Preview SQL"}
              </Button>
            </div>
          </td>
        ) : (
          <td>
            <div className="text-center">-</div>
          </td>
        )}
      </tr>
      {sqlPreview && (
        <tr
          className="bg-light"
          style={{
            boxShadow: "rgba(0, 0, 0, 0.06) 0px 2px 4px 0px inset",
          }}
        >
          <td colSpan={4}>
            <SQLInputField
              showPreview
              userEnteredQuery={sqlPreview}
              datasourceId={dataSourceId}
              form={form}
              requiredColumns={new Set()}
              queryType="metric"
              showTestButton={false}
              showHeadline={false}
            />
          </td>
        </tr>
      )}
    </>
  );
}
