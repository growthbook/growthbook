import { FC, ChangeEventHandler, useState } from "react";
import { SnowflakeConnectionParams } from "back-end/types/integrations/snowflake";
import Tooltip from "@/components/Tooltip/Tooltip";
import Switch from "@/ui/Switch";
import { GBInfo } from "@/components/Icons";
import FileInput from "@/components/FileInput";

const SnowflakeForm: FC<{
  params: Partial<SnowflakeConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  onManualParamChange: (name: string, value: string) => void;
}> = ({ params, existing, onParamChange, onManualParamChange }) => {
  const [useAccessUrl, setUseAccessUrl] = useState(!!params.accessUrl);
  const [originalAuthMethod] = useState(params.authMethod);
  // Convenience variable for the auth method to handle undefined
  const authMethod = params.authMethod ?? "password";

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
        <label>Authentication Method</label>
        <select
          className="form-control"
          autoComplete="off"
          name="authMethod"
          value={params.authMethod ?? "password"}
          onChange={(e) => onManualParamChange("authMethod", e.target.value)}
        >
          <option value="password">Password</option>
          <option value="key-pair">Key Pair</option>
        </select>
      </div>

      {authMethod === "password" ? (
        <div className="form-group col-md-12">
          <label>Password</label>
          <input
            type="text"
            className="form-control password-presentation"
            autoComplete="off"
            name="password"
            required={!existing || authMethod !== originalAuthMethod}
            value={params.password || ""}
            onChange={onParamChange}
            placeholder={
              existing && authMethod === originalAuthMethod
                ? "(Keep existing)"
                : ""
            }
          />
        </div>
      ) : null}

      {authMethod === "key-pair" ? (
        <>
          <div className="form-group col-md-12">
            <label>Private Key File</label>
            <FileInput
              name="privateKey"
              required={!existing || authMethod !== originalAuthMethod}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = () => {
                    onManualParamChange("privateKey", reader.result as string);
                  };
                  reader.readAsText(file);
                }
              }}
              placeholder={
                existing && authMethod === originalAuthMethod
                  ? "(Keep existing)"
                  : "Select a private key file"
              }
            />
          </div>

          <div className="form-group col-md-12">
            <label>
              Private Key Password{" "}
              <Tooltip body="If your private key is encrypted, you will need to enter the password used to encrypt it.">
                <GBInfo />
              </Tooltip>
            </label>
            <input
              type="text"
              className="form-control password-presentation"
              autoComplete="off"
              name="privateKeyPassword"
              value={params.privateKeyPassword || ""}
              onChange={onParamChange}
              placeholder={
                existing && authMethod === originalAuthMethod
                  ? "(Keep existing)"
                  : ""
              }
            />
          </div>
        </>
      ) : null}

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
          <Switch
            id="access-url"
            label="Use Access URL (optional)"
            value={useAccessUrl}
            onChange={(v) => {
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
