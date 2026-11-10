import { FC, ChangeEventHandler, useState } from "react";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import { Box } from "@radix-ui/themes";
import { ClickHouseConnectionParams } from "shared/types/integrations/clickhouse";
import { KEEP_EXISTING_PLACEHOLDER } from "@/components/Forms/secretInput";
import Field from "@/components/Forms/Field";
import { isCloud } from "@/services/env";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import HostWarning from "./HostWarning";
import SSLConnectionFields from "./SSLConnectionFields";

const ClickHouseForm: FC<{
  params: Partial<ClickHouseConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  setParams: (params: { [key: string]: string | boolean | null }) => void;
  showAllowlist?: boolean;
}> = ({ params, existing, onParamChange, setParams, showAllowlist }) => {
  const [showPaths, setShowPaths] = useState(
    !!(
      params.caCertPath ||
      params.clientCertPath ||
      params.clientKeyPath ||
      params.clientCertChainPath
    ),
  );

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
        <SSLConnectionFields
          existing={existing}
          onParamChange={onParamChange}
          setSSL={(ssl) => setParams({ ssl })}
          setCertRemoved={(name, removed) =>
            setParams({ [name]: removed ? null : "" })
          }
          value={{
            ssl: !!params.ssl,
            caCert: params.caCert,
            clientCert: params.clientCert,
            clientKey: params.clientKey,
          }}
        />
      </div>
      {params.ssl && !isCloud() && (
        <Box mb="3">
          <Box mb="3">
            <Link onClick={() => setShowPaths(!showPaths)}>
              Certificate file paths{" "}
              {showPaths ? <FaCaretDown /> : <FaCaretRight />}
            </Link>
          </Box>
          {showPaths && (
            <>
              <Text as="p" size="sm" color="text-mid" mb="3">
                PEM files on the GrowthBook server, used instead of the pasted
                certificates above. They are read for every query, so
                certificates rotated on disk are picked up without a restart.
              </Text>
              <Field
                label="CA cert path"
                name="caCertPath"
                placeholder="/etc/ssl/certs/ca.crt"
                value={params.caCertPath || ""}
                onChange={onParamChange}
              />
              <Field
                label="Client cert path"
                name="clientCertPath"
                placeholder="/etc/ssl/client/tls.crt"
                value={params.clientCertPath || ""}
                onChange={onParamChange}
              />
              <Field
                label="Client cert chain path (optional)"
                name="clientCertChainPath"
                placeholder="/etc/ssl/client/chain.crt"
                value={params.clientCertChainPath || ""}
                onChange={onParamChange}
                helpText="Intermediate CA certs sent after the client cert. Needed when the client cert file contains only the leaf and ClickHouse trusts only the root CA."
              />
              <Field
                label="Client key path"
                name="clientKeyPath"
                placeholder="/etc/ssl/client/tls.key"
                value={params.clientKeyPath || ""}
                onChange={onParamChange}
              />
            </>
          )}
        </Box>
      )}
    </>
  );
};

export default ClickHouseForm;
