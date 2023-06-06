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
        <td>
          <div className="d-flex flex-column justify-content-center align-items-center">
            <Toggle
              value={event.metricsToCreate[0].shouldCreate || false}
              id={`${event}-${i}-${event.metricsToCreate[0].type}`}
              setValue={(value) => {
                const updatedTrackedEvents = cloneDeep(trackedEvents);
                updatedTrackedEvents[i].metricsToCreate[0].shouldCreate = value;
                setTrackedEvents(updatedTrackedEvents);
              }}
            />
            <Button
              color="link"
              onClick={async () =>
                handleSqlPreview(event.metricsToCreate[0].sql)
              }
            >
              {sqlPreview && sqlPreview === event.metricsToCreate[0].sql
                ? "Hide SQL"
                : "Preview SQL"}
            </Button>
          </div>
        </td>
        <td>
          <div className="d-flex flex-column justify-content-center align-items-center">
            <Toggle
              value={event.metricsToCreate[1].shouldCreate || false}
              id={`${event}-${i}-${event.metricsToCreate[1].type}`}
              setValue={(value) => {
                const updatedTrackedEvents = cloneDeep(trackedEvents);
                updatedTrackedEvents[i].metricsToCreate[1].shouldCreate = value;
                setTrackedEvents(updatedTrackedEvents);
              }}
            />
            <Button
              color="link"
              onClick={async () =>
                handleSqlPreview(event.metricsToCreate[1].sql)
              }
            >
              {sqlPreview && sqlPreview === event.metricsToCreate[1].sql
                ? "Hide SQL"
                : "Preview SQL"}
            </Button>
          </div>
        </td>
      </tr>
      {sqlPreview && (
        <tr>
          <td colSpan={4}>
            <SQLInputField
              showPreview
              userEnteredQuery={sqlPreview}
              datasourceId={dataSourceId}
              form={form}
              requiredColumns={new Set()}
              queryType="metric"
              showTestButton={false}
            />
          </td>
        </tr>
      )}
    </>
  );
}
