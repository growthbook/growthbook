import { FC, ChangeEventHandler, useState } from "react";
import { SnowflakeConnectionParams } from "back-end/types/integrations/snowflake";
import Tooltip from "@/components/Tooltip/Tooltip";
import Toggle from "@/components/Forms/Toggle";

const SnowflakeForm: FC<{
  params: Partial<SnowflakeConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  onManualParamChange: (name: string, value: string) => void;
}> = ({ params, existing, onParamChange, onManualParamChange }) => {
  const [useAccessUrl, setUseAccessUrl] = useState(!!params.accessUrl);
  return (
    <div className="row">
      <div className="form-group col-md-12">
        <label>Account</label>
        <input
          type="text"
          className="form-control"
          name="account"
          required
          placeholder="xy12345.us-east-2.aws"
          value={params.account || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Username</label>
        <input
          type="text"
          className="form-control"
          name="username"
          required
          value={params.username || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Password</label>
        <input
          type="text"
          className="form-control password-presentation"
          autoComplete="off"
          name="password"
          required={!existing}
          value={params.password || ""}
          onChange={onParamChange}
          placeholder={existing ? "(Keep existing)" : ""}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Database</label>
        <input
          type="text"
          className="form-control"
          name="database"
          required
          value={params.database || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Schema</label>
        <input
          type="text"
          className="form-control"
          name="schema"
          required
          value={params.schema || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Role</label>
        <input
          type="text"
          className="form-control"
          name="role"
          value={params.role || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>
          Warehouse (Optional){" "}
          <Tooltip body="If no Warehouse is specified, queries will be executed in the default Warehouse for your User, set in Snowflake." />
        </label>
        <input
          type="text"
          className="form-control"
          name="warehouse"
          value={params.warehouse || ""}
          onChange={onParamChange}
          placeholder=""
        />
      </div>
      <div className="col-md-12">
        <div className="form-group">
          <label htmlFor="access-url" className="mr-2">
            Use Access URL (Optional)
          </label>
          <Toggle
            id="access-url"
            label="Use Access URL (Optional)"
            value={useAccessUrl}
            setValue={(v) => {
              setUseAccessUrl(v);
              if (!v) {
                onManualParamChange("accessUrl", "");
              }
            }}
          />
        </div>
      </div>
      {useAccessUrl ? (
        <div className="form-group col-md-12">
          <label>
            Access URL{" "}
            <Tooltip body="Overrides Account to point GrowthBook at a specific URL" />
          </label>
          <input
            type="text"
            className="form-control"
            name="accessUrl"
            required
            value={params.accessUrl || ""}
            onChange={onParamChange}
          />
        </div>
      ) : null}
    </div>
  );
};

export default SnowflakeForm;
