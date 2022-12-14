import { FC, ChangeEventHandler } from "react";
import { MssqlConnectionParams } from "back-end/types/integrations/mssql";
import Toggle from "../Forms/Toggle";
import Tooltip from "../Tooltip/Tooltip";
import HostWarning from "./HostWarning";

const MssqlForm: FC<{
  params: Partial<MssqlConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  setParams: (params: {
    [key: string]: string | boolean | number | Record<string, unknown>;
  }) => void;
}> = ({ params, existing, onParamChange, setParams }) => {
  return (
    <>
      <HostWarning
        host={params.server}
        setHost={(host) => {
          setParams({
            server: host,
          });
        }}
      />
      <div className="row">
        <div className="form-group col-md-12">
          <label>Server</label>
          <input
            type="text"
            className="form-control"
            name="server"
            required
            value={params.server || ""}
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
            value={params.port || ""}
            onChange={onParamChange}
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
          <label>User</label>
          <input
            type="text"
            className="form-control"
            name="user"
            required
            value={params.user || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-12">
          <label>Password</label>
          <input
            type="text"
            className="form-control password-presentation"
            name="password"
            required={!existing}
            value={params.password || ""}
            onChange={onParamChange}
            placeholder={existing ? "(Keep existing)" : ""}
          />
        </div>
      </div>
      <div className="row mt-2">
        <div className="col-md-12">
          <div className="form-group">
            <label htmlFor="trust-server-cert" className="mr-2">
              Trust server certificate{" "}
              <Tooltip body="Allows for self-signed certificates"></Tooltip>
            </label>
            <Toggle
              id="trust-server-cert"
              label="Trust server certificate"
              value={params.options.trustServerCertificate === true}
              setValue={(value) => {
                const opt = {
                  ...params.options,
                  trustServerCertificate: value,
                };
                setParams({
                  options: opt,
                });
              }}
            />
          </div>
          <div className="form-group">
            <label htmlFor="encryption" className="mr-2">
              Enable encryption
            </label>
            <Toggle
              id="encryption"
              label="Enable encryption"
              value={params.options.encrypt === true}
              setValue={(value) => {
                const opt = { ...params.options, encrypt: value };
                setParams({
                  options: opt,
                });
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default MssqlForm;
