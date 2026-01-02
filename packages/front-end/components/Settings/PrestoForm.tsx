import { FC, ChangeEventHandler } from "react";
import { PrestoConnectionParams } from "shared/types/integrations/presto";
import SelectField from "@/components/Forms/SelectField";
import { isCloud } from "@/services/env";
import HostWarning from "./HostWarning";
import SSLConnectionFields from "./SSLConnectionFields";

const PrestoForm: FC<{
  params: Partial<PrestoConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  onManualParamChange: (name: string, value: string) => void;
  setParams: (params: { [key: string]: string | boolean }) => void;
}> = ({ params, existing, onParamChange, onManualParamChange, setParams }) => {
  const authMethodOptions = [
    {
      value: "basicAuth",
      label: "Basic Auth (Username/Password)",
    },
    {
      value: "customAuth",
      label: "Custom Auth (HTTP Authorization header)",
    },
    ...(!isCloud()
      ? [
          {
            value: "kerberos",
            label: "Kerberos",
          },
        ]
      : []),
    {
      value: "none",
      label: "None (Authentication handled outside of GrowthBook)",
    },
  ];

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
      <div className="form-group col-md-12">
        <label>User</label>
        <input
          type="text"
          className="form-control"
          name="user"
          value={params.user || "growthbook"}
          onChange={onParamChange}
        />
        <small className="form-text text-muted">
          The user to connect as. Defaults to &quot;growthbook&quot;.
        </small>
      </div>
      <div className="col-md-12">
        <SelectField
          label="Authentication Method"
          options={authMethodOptions}
          helpText="Basic Auth is the most common method. Custom Auth sets HTTP Authorization header with the provided string. Kerberos auth uses KRB5 authentication with client principal. 'None' only is used for custom authentication methods."
          value={params.authType || "basicAuth"}
          onChange={(v) => {
            setParams({
              authType: v,
            });
          }}
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
      {params.authType === "kerberos" && (
        <>
          <div className="form-group col-md-12">
            <label>Service Principal</label>
            <input
              type="text"
              className="form-control"
              name="kerberosServicePrincipal"
              required
              value={params.kerberosServicePrincipal || ""}
              onChange={onParamChange}
              placeholder="presto@db.example.com"
            />
            <small className="form-text text-muted">
              The service principal that you want to connect to. Accepts both
              full principal (<code>PRESTO/db.example.com@REALM</code>) and
              library format (<code>presto@db.example.com</code>).
            </small>
          </div>
          <div className="form-group col-md-12">
            <label>GrowthBook Client Principal</label>
            <input
              type="text"
              className="form-control"
              name="kerberosClientPrincipal"
              value={params.kerberosClientPrincipal || ""}
              onChange={onParamChange}
              placeholder="HTTP/growthbook.example.com@REALM"
              pattern="[^/]+\/[^@]+@.+"
              title="Must be in the format service/hostname@REALM"
            />
            <small className="form-text text-muted">
              The client (GrowthBook) principal. If not specified, the default
              principal from the system will be used. Should contain the full
              principal (<code>http/growthbook.example.com@REALM</code>) when
              provided.
            </small>
          </div>
          <div className="form-group col-md-12">
            <label>Kerberos User</label>
            <input
              type="text"
              className="form-control"
              name="kerberosUser"
              value={params.kerberosUser || ""}
              onChange={onParamChange}
              placeholder="growthbook"
            />
            <small className="form-text text-muted">
              This is the value used in the <code>X-Trino-User</code> header.
              Defaults to <code>growthbook</code> if not specified.
            </small>
          </div>
        </>
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
