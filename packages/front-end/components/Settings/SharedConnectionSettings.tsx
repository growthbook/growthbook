import { DataSourceSettings, DataSourceType } from "shared/types/datasource";
import { ChangeEventHandler, useId } from "react";
import { getDefaultMaxConcurrentQueries } from "shared/util";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

export interface Props {
  type: DataSourceType;
  settings: Partial<DataSourceSettings>;
  onSettingChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
}

export default function SharedConnectionSettings({
  type,
  settings,
  onSettingChange,
}: Props) {
  const maxConcurrentQueriesId = useId();
  const queryCacheTTLId = useId();
  // Datasources with a nonzero default apply it when the field is left blank.
  const defaultMaxConcurrentQueries = getDefaultMaxConcurrentQueries(type);
  const maxConcurrentQueriesHelpText =
    defaultMaxConcurrentQueries > 0
      ? `Leave empty to use the default of ${defaultMaxConcurrentQueries}. Enter 0 for no limit on the number of concurrent queries.`
      : "A value of 0 or an empty field will result in no limit on the number of queries";

  return (
    <>
      <TextField
        mb="3"
        id={maxConcurrentQueriesId}
        name="maxConcurrentQueries"
        type="number"
        label={
          <Text as="label" htmlFor={maxConcurrentQueriesId} weight="semibold">
            Maximum concurrent queries (optional){" "}
            <Tooltip
              body={
                "When executing queries against this datasource, if this many queries are already" +
                " running then new connections will wait for existing connections to finish. This" +
                " limit is not exact, e.g. if set to 100 it still might allow slightly over 100" +
                " queries to run simultaneously if many are initiated by a single experiment update"
              }
            />
          </Text>
        }
        helpText={maxConcurrentQueriesHelpText}
        placeholder={
          defaultMaxConcurrentQueries > 0
            ? String(defaultMaxConcurrentQueries)
            : undefined
        }
        value={settings.maxConcurrentQueries || ""}
        onChange={onSettingChange}
        min={0}
      />
      <TextField
        mb="3"
        id={queryCacheTTLId}
        name="queryCacheTTLMins"
        type="number"
        label={
          <Text as="label" htmlFor={queryCacheTTLId} weight="semibold">
            Query cache TTL (minutes, optional){" "}
            <Tooltip
              body={
                "When running queries against this datasource, results from identical queries " +
                "run within this time window will be reused instead of executing a new query. " +
                "This helps prevent errant updates from hitting your warehouse multiple times. "
              }
            />
          </Text>
        }
        helpText="Leave empty to use the global default (QUERY_CACHE_TTL_MINS environment variable, default 60 minutes)"
        value={settings.queryCacheTTLMins || ""}
        onChange={onSettingChange}
        min={0}
      />
    </>
  );
}
