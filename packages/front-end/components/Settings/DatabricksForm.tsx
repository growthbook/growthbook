import { FC, ChangeEventHandler } from "react";
import { DatabricksConnectionParams } from "back-end/types/integrations/databricks";
import Field from "../Forms/Field";
import HostWarning from "./HostWarning";

const DatabricksForm: FC<{
  params: Partial<DatabricksConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  setParams: (params: { [key: string]: string | boolean }) => void;
}> = ({ params, existing, onParamChange, setParams }) => {
  return (
    <div className="row">
      <div>
        <HostWarning
          // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
          host={params.host}
          setHost={(host) => {
            setParams({
              host,
            });
          }}
        />
      </div>
      <div className="form-group">
        <label>Server Hostname</label>
        <input
          type="text"
          className="form-control"
          name="host"
          required
          value={params.host || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group">
        <label>Port</label>
        <input
          type="number"
          className="form-control"
          name="port"
          required
          value={params.port || 443}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group">
        <label>HTTP Path</label>
        <input
          type="text"
          className="form-control"
          name="path"
          required
          value={params.path || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group">
        <label>Token</label>
        <input
          type="text"
          className="form-control"
          name="token"
          value={params.token || ""}
          onChange={onParamChange}
          placeholder={existing ? "(Keep existing)" : ""}
        />
      </div>
      <div className="form-group">
        <Field
          label="Default Catalog (Recommended)"
          helpText="This will be help GrowthBook generate the initial SQL queries used to define things like Metrics and Experiment Assignments."
          value={params.catalog || ""}
          onChange={onParamChange}
          name="catalog"
        />
      </div>
    </div>
  );
};

export default DatabricksForm;
