import { FC, ChangeEventHandler, useState } from "react";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import { Box } from "@radix-ui/themes";
import { ClickHouseConnectionParams } from "shared/types/integrations/clickhouse";
import { KEEP_EXISTING_PLACEHOLDER } from "@/components/Forms/secretInput";
import { isCloud } from "@/services/env";
import Field from "@/components/Forms/Field";
import Link from "@/ui/Link";
import HostWarning from "./HostWarning";

const ClickHouseForm: FC<{
  params: Partial<ClickHouseConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  setParams: (params: { [key: string]: string }) => void;
  showAllowlist?: boolean;
}> = ({ params, existing, onParamChange, setParams, showAllowlist }) => {
  const usesClientCert = !!(
    params.clientCertPath ||
    params.clientKeyPath ||
    params.clientCertChainPath
  );
  const [showTls, setShowTls] = useState(!!params.caCertPath || usesClientCert);

  return (
    <>
      <HostWarning
        host={params.url}
        showAllowlist={showAllowlist}
        setHost={(url) => {
          setParams({
            url,
          });
        }}
      />
      <div className="row">
        <div className="form-group col-md-12">
          <label>URL</label>
          <input
            type="text"
            className="form-control"
            name="url"
            required
            value={params.url || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-6">
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
        <div className="form-group col-md-6">
          <label>Database</label>
          <input
            type="text"
            className="form-control"
            name="database"
            value={params.database || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-6">
          <label>Username</label>
          <input
            type="text"
            className="form-control"
            name="username"
            value={params.username || ""}
            onChange={onParamChange}
          />
        </div>
        <div className="form-group col-md-6">
          <label>Password</label>
          <input
            type="text"
            className="form-control password-presentation"
            autoComplete="off"
            name="password"
            value={params.password || ""}
            onChange={onParamChange}
            placeholder={existing ? KEEP_EXISTING_PLACEHOLDER : ""}
          />
        </div>
        <div className="form-group col-md-12">
          <label>Max Query Execution Time (seconds)</label>
          <input
            type="number"
            className="form-control"
            name="maxExecutionTime"
            value={params.maxExecutionTime}
            onChange={onParamChange}
            min={0}
            max={3600}
            placeholder={"Default: 1800"}
          />
        </div>
      </div>
      {!isCloud() && (
        <Box>
          <Box mb="3">
            <Link onClick={() => setShowTls(!showTls)}>
              Advanced TLS settings{" "}
              {showTls ? <FaCaretDown /> : <FaCaretRight />}
            </Link>
          </Box>
          {showTls && (
            <>
              <Field
                label="CA certificate path"
                name="caCertPath"
                placeholder="/etc/ssl/certs/ca.crt"
                value={params.caCertPath || ""}
                onChange={onParamChange}
                required={usesClientCert}
                helpText="PEM file on the GrowthBook server used to verify the ClickHouse server. Requires an https:// URL."
              />
              <Field
                label="Client certificate path"
                name="clientCertPath"
                placeholder="/etc/ssl/client/tls.crt"
                value={params.clientCertPath || ""}
                onChange={onParamChange}
                required={usesClientCert}
              />
              <Field
                label="Client certificate chain path (optional)"
                name="clientCertChainPath"
                placeholder="/etc/ssl/client/chain.crt"
                value={params.clientCertChainPath || ""}
                onChange={onParamChange}
                helpText="Intermediate CA certificates sent after the client certificate. Needed when the client certificate file contains only the leaf and ClickHouse trusts only the root CA."
              />
              <Field
                label="Client key path"
                name="clientKeyPath"
                placeholder="/etc/ssl/client/tls.key"
                value={params.clientKeyPath || ""}
                onChange={onParamChange}
                required={usesClientCert}
                helpText="With a client certificate, ClickHouse authenticates the user by certificate and the password is not sent. Files are read for each connection, so rotated certificates are picked up automatically."
              />
            </>
          )}
        </Box>
      )}
    </>
  );
};

export default ClickHouseForm;
