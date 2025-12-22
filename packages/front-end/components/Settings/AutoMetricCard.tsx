import { ago } from "shared/dates";
import { cloneDeep } from "lodash";
import { useState } from "react";
import { AutoMetricTrackedEvent } from "shared/types/integrations";
import Tooltip from "@/components/Tooltip/Tooltip";
import Switch from "@/ui/Switch";
import Button from "@/components/Button";
import SQLInputField from "@/components/SQLInputField";
import DSTooltip from "@/ui/Tooltip";

type Props = {
  event: AutoMetricTrackedEvent;
  trackedEvents: AutoMetricTrackedEvent[];
  setTrackedEvents: (events: AutoMetricTrackedEvent[]) => void;
  dataSourceId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  i: number;
};

export default function AutoMetricCard({
  event,
  trackedEvents,
  setTrackedEvents,
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

  const binomialIndex = event.metricsToCreate.findIndex(
    (metric) => metric.type === "binomial",
  );

  const countIndex = event.metricsToCreate.findIndex(
    (metric) => metric.type === "count",
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
        {event.metricsToCreate[binomialIndex]?.sql ? (
          <td className={selected === binomialIndex ? "bg-light" : ""}>
            <div className="d-flex flex-column justify-content-center align-items-center">
              <DSTooltip
                content="This metric has already been created."
                enabled={
                  event.metricsToCreate[binomialIndex].alreadyExists || false
                }
              >
                <Switch
                  value={
                    event.metricsToCreate[binomialIndex].shouldCreate || false
                  }
                  disabled={
                    event.metricsToCreate[binomialIndex].alreadyExists || false
                  }
                  id={`${event}-${event.metricsToCreate[binomialIndex].name}`}
                  onChange={(value) => {
                    const updates = cloneDeep(trackedEvents);
                    updates[i].metricsToCreate[binomialIndex].shouldCreate =
                      value;
                    setTrackedEvents(updates);
                  }}
                />
              </DSTooltip>
              <Button
                color="link"
                onClick={async () =>
                  handleSqlPreview(event.metricsToCreate[binomialIndex].sql)
                }
              >
                {selected === binomialIndex ? "Hide SQL" : "Preview SQL"}
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
              <DSTooltip
                content="This metric has already been created."
                enabled={
                  event.metricsToCreate[countIndex].alreadyExists || false
                }
              >
                <Switch
                  value={
                    event.metricsToCreate[countIndex].shouldCreate || false
                  }
                  id={`${event}-${event.metricsToCreate[countIndex].name}`}
                  disabled={
                    event.metricsToCreate[countIndex].alreadyExists || false
                  }
                  onChange={(value) => {
                    const updates = cloneDeep(trackedEvents);
                    updates[i].metricsToCreate[countIndex].shouldCreate = value;
                    setTrackedEvents(updates);
                  }}
                />
              </DSTooltip>
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
