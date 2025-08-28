import { FC, ChangeEventHandler } from "react";
import { PrestoConnectionParams } from "back-end/types/integrations/presto";
import SelectField from "@/components/Forms/SelectField";
import HostWarning from "./HostWarning";
import SSLConnectionFields from "./SSLConnectionFields";

const PrestoForm: FC<{
  params: Partial<PrestoConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  onManualParamChange: (name: string, value: string) => void;
  setParams: (params: { [key: string]: string | boolean }) => void;
}> = ({ params, existing, onParamChange, onManualParamChange, setParams }) => {
  return (
    <div className="row">
      <div className="form-group col-md-12">
        <label>Engine</label>
        <SelectField
          name="engine"
          required
          value={params.engine || ""}
          onChange={(v) => {
            onManualParamChange("engine", v);
          }}
          options={[
            { value: "presto", label: "presto" },
            { value: "trino", label: "trino" },
          ]}
        />
      </div>
      <div className="form-group col-md-12">
        <SelectField
          label="Authentication Method"
          options={[
            {
              value: "basicAuth",
              label: "Basic Auth (Username/Password)",
            },
            {
              value: "customAuth",
              label: "Custom Auth (HTTP Authorization header)",
            },
            {
              value: "none",
              label: "None (Authentication handled outside of GrowthBook)",
            },
          ]}
          helpText="Basic Auth is the most common method. Custom Auth sets HTTP Authorization header with the provided string. 'None' only is used for custom authentication methods."
          value={params.authType || "basicAuth"}
          onChange={(v) => {
            setParams({
              authType: v,
            });
          }}
        />
      </div>
      <div className=" col-md-12">
        <HostWarning
          host={params.host ?? ""}
          setHost={(host) => {
            setParams({
              host,
            });
          }}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Host</label>
        <input
          type="text"
          className="form-control"
          name="host"
          required
          value={params.host || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Port</label>
        <input
          type="number"
          className="form-control"
          name="port"
          required
          value={params.port || 0}
          onChange={onParamChange}
        />
      </div>
      {(params.authType ?? "basicAuth") === "basicAuth" && (
        <>
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
              className="form-control"
              name="password"
              value={params.password || ""}
              onChange={onParamChange}
              placeholder={existing ? "(Keep existing)" : ""}
            />
          </div>
        </>
      )}
      {params.authType === "customAuth" && (
        <div className="form-group col-md-12">
          <label>Custom Auth String</label>
          <input
            type="text"
            className="form-control"
            name="customAuth"
            value={params.customAuth || ""}
            onChange={onParamChange}
          />
        </div>
      )}
      <div className="form-group col-md-12">
        <label>Default Catalog</label>
        <input
          type="text"
          className="form-control"
          name="catalog"
          value={params.catalog || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Request Timeout</label>
        <input
          type="number"
          className="form-control"
          name="requestTimeout"
          value={params.requestTimeout || ""}
          onChange={onParamChange}
          placeholder="(optional - in seconds. If empty or 0, there will be no limit)"
        />
        <div className="form-text text-muted small">
          The number of seconds before a request will timeout. Set to 0 to
          disable timeout.
        </div>
      </div>
      <div className="form-group col-md-12">
        <label>Default Schema</label>
        <input
          type="text"
          className="form-control"
          name="schema"
          value={params.schema || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="form-group col-md-12">
        <label>Source</label>
        <input
          type="text"
          className="form-control"
          name="source"
          value={params.source || "GrowthBook"}
          onChange={onParamChange}
        />
        <small className="form-text text-muted">
          This helps identify the connection as coming from GrowthBook.
        </small>
      </div>
      <SSLConnectionFields
        onParamChange={onParamChange}
        setSSL={(ssl) => setParams({ ssl })}
        value={{
          // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'boolean | undefined' is not assignable to ty... Remove this comment to see the full error message
          ssl: params.ssl,
          caCert: params.caCert,
          clientCert: params.clientCert,
          clientKey: params.clientKey,
        }}
      />
    </div>
  );
};

export default PrestoForm;
