import { FC, ChangeEventHandler } from "react";
import { Flex } from "@radix-ui/themes";
import { MssqlConnectionParams } from "shared/types/integrations/mssql";
import Checkbox from "@/ui/Checkbox";
import Tooltip from "@/components/Tooltip/Tooltip";
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
        host={params.server ?? ""}
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
        <div className="form-group col-md-12">
          <label>Request Timeout</label>
          <input
            type="number"
            className="form-control"
            name="requestTimeout"
            value={params.requestTimeout || ""}
            onChange={onParamChange}
            placeholder="(optional - in seconds. If empty, it will be disabled)"
          />
          <div className="form-text text-muted small">
            The number of seconds before a request is considered failed. The
            connection default is 15 seconds. Set to 0 to disable timeout.
          </div>
        </div>
        <div className="form-group col-md-12">
          <label>Default Schema</label>
          <input
            type="text"
            className="form-control"
            name="defaultSchema"
            value={params.defaultSchema || ""}
            onChange={onParamChange}
            placeholder="(optional)"
          />
        </div>
      </div>
      <div className="row mt-2">
        <div className="col-md-12">
          <div className="form-group">
            <Flex align="center" gap="1">
              <Checkbox
                id="trust-server-cert"
                label="Trust server certificate"
                value={params.options?.trustServerCertificate === true}
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
              <Tooltip body="Allows for self-signed certificates" />
            </Flex>
          </div>
          <div className="form-group">
            <Checkbox
              id="encryption"
              label="Enable encryption"
              value={params.options?.encrypt === true}
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
