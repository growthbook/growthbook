import { DataSourceSettings } from "shared/types/datasource";
import { ChangeEventHandler } from "react";
import { PiCaretRightFill } from "react-icons/pi";
import Collapsible from "react-collapsible";
import Tooltip from "@/components/Tooltip/Tooltip";
import Field from "@/components/Forms/Field";

export interface Props {
  settings: Partial<DataSourceSettings>;
  onSettingChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
}

export default function SharedConnectionSettings({
  settings,
  onSettingChange,
}: Props) {
  // Auto-expand if either setting has a value
  const hasExistingSettings =
    settings.maxConcurrentQueries !== undefined ||
    settings.queryCacheTTLMins !== undefined;

  return (
    <div className="mb-3">
      <Collapsible
        trigger={
          <div className="link-purple font-weight-bold mb-2">
            <PiCaretRightFill className="chevron mr-1" />
            Advanced Settings
          </div>
        }
        open={hasExistingSettings}
        transitionTime={100}
      >
        <div className="rounded px-3 pt-3 pb-1 bg-highlight">
          <Field
            name="maxConcurrentQueries"
            type="number"
            label={
              <>
                Maximum Concurrent Queries (optional){" "}
                <Tooltip
                  body={
                    "When executing queries against this datasource, if this many queries are already" +
                    " running then new connections will wait for existing connections to finish. This" +
                    " limit is not exact, e.g. if set to 100 it still might allow slightly over 100" +
                    " queries to run simultaneously if many are initiated by a single experiment update"
                  }
                />
              </>
            }
            helpText="A value of 0 or an empty field will result in no limit on the number of queries"
            value={settings.maxConcurrentQueries || ""}
            onChange={onSettingChange}
            min={0}
          />
          <Field
            name="queryCacheTTLMins"
            type="number"
            label={
              <>
                Query Cache TTL (minutes, optional){" "}
                <Tooltip
                  body={
                    "When running queries against this datasource, results from identical queries " +
                    "run within this time window will be reused instead of executing a new query. " +
                    "This helps reduce load on your data warehouse and speeds up experiment updates."
                  }
                />
              </>
            }
            helpText="Leave empty to use the global default (QUERY_CACHE_TTL_MINS environment variable, default 60 minutes)"
            value={settings.queryCacheTTLMins || ""}
            onChange={onSettingChange}
            min={0}
          />
        </div>
      </Collapsible>
    </div>
  );
}
