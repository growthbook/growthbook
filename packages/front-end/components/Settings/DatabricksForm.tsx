import { FC, ChangeEventHandler } from "react";
import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import {
  KEEP_EXISTING_PLACEHOLDER,
  useCanKeepExistingCredentials,
} from "@/components/Forms/secretInput";
import HostWarning from "./HostWarning";

const DatabricksForm: FC<{
  params: Partial<DatabricksConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  setParams: (params: { [key: string]: string | boolean }) => void;
}> = ({ params, existing, onParamChange, setParams }) => {
  const authType = params.authType ?? "pat";
  const canKeepExistingCredentials = useCanKeepExistingCredentials(
    existing,
    authType,
  );

  return (
    <div className="row">
      <div className="col-md-12">
        <HostWarning
          host={params.host}
          setHost={(host) => {
            setParams({
              host,
            });
          }}
        />
      </div>
      <div className="form-group col-md-12">
        <TextField
          label="Server hostname"
          name="host"
          required
          value={params.host || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <TextField
          label="Port"
          type="number"
          name="port"
          required
          value={params.port || 443}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <TextField
          label="HTTP path"
          name="path"
          required
          value={params.path || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <Select
          label="Authentication method"
          value={authType}
          setValue={(value) => setParams({ authType: value })}
        >
          <SelectItem value="oauth-m2m">
            Databricks OAuth (machine-to-machine)
          </SelectItem>
          <SelectItem value="azure-entra">
            Azure Entra ID service principal
          </SelectItem>
          <SelectItem value="pat">Personal access token</SelectItem>
        </Select>
      </div>

      {authType === "oauth-m2m" || authType === "azure-entra" ? (
        <>
          {authType === "azure-entra" ? (
            <div className="form-group col-md-12">
              <TextField
                label="Tenant ID"
                name="azureTenantId"
                required
                value={params.azureTenantId || ""}
                onChange={onParamChange}
              />
            </div>
          ) : null}
          <div className="form-group col-md-12">
            <TextField
              label="Client ID"
              name="oauthClientId"
              required
              value={params.oauthClientId || ""}
              onChange={onParamChange}
            />
          </div>
          <div className="form-group col-md-12">
            <TextField
              label="OAuth secret"
              type="password"
              autoComplete="off"
              name="oauthClientSecret"
              required={!canKeepExistingCredentials}
              value={params.oauthClientSecret || ""}
              onChange={onParamChange}
              placeholder={
                canKeepExistingCredentials ? KEEP_EXISTING_PLACEHOLDER : ""
              }
            />
          </div>
        </>
      ) : (
        <div className="form-group col-md-12">
          <TextField
            label="Token"
            type="password"
            autoComplete="off"
            name="token"
            required={!canKeepExistingCredentials}
            value={params.token || ""}
            onChange={onParamChange}
            placeholder={
              canKeepExistingCredentials ? KEEP_EXISTING_PLACEHOLDER : ""
            }
          />
        </div>
      )}
      <div className="form-group col-md-12">
        <TextField
          label="Default catalog (recommended)"
          helpText="This will help GrowthBook generate the initial SQL queries used to define things like Metrics and Experiment Assignments."
          name="catalog"
          value={params.catalog || ""}
          onChange={onParamChange}
        />
      </div>
    </div>
  );
};

export default DatabricksForm;
