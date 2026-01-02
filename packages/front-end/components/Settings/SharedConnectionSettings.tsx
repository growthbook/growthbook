import { DataSourceSettings } from "shared/types/datasource";
import { ChangeEventHandler } from "react";
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
  return (
    <>
      <div className="row">
        <div className="col-md-12">
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
        </div>
      </div>
    </>
  );
}
