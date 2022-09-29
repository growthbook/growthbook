import { FC, ChangeEventHandler, useState } from "react";
import { PrestoConnectionParams } from "back-end/types/integrations/presto";
import HostWarning from "./HostWarning";
import Toggle from "../Forms/Toggle";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import Field from "../Forms/Field";

const PrestoForm: FC<{
  params: Partial<PrestoConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  setParams: (params: { [key: string]: string | boolean }) => void;
}> = ({ params, existing, onParamChange, setParams }) => {
  const [certs, setCerts] = useState(false);
  return (
    <div className="row">
      <div className="form-group col-md-12">
        <label>Engine</label>
        <select
          className="form-control"
          name="engine"
          required
          value={params.engine || ""}
          onChange={onParamChange}
        >
          <option value="presto">presto</option>
          <option value="trino">trino</option>
        </select>
      </div>
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
        <label>Default Schema</label>
        <input
          type="text"
          className="form-control"
          name="schema"
          value={params.schema || ""}
          onChange={onParamChange}
        />
      </div>
      <div className="col-md-12">
        <div className="form-group">
          <label htmlFor="require-ssl" className="mr-2">
            Require SSL
          </label>
          <Toggle
            id="require-ssl"
            label="Require SSL"
            value={params.ssl === true}
            setValue={(value) => {
              setParams({
                ssl: value,
              });
            }}
          />
          {params.ssl && (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setCerts(!certs);
              }}
            >
              Advanced SSL Settings {certs ? <FaCaretDown /> : <FaCaretRight />}
            </a>
          )}
        </div>
      </div>
      {params.ssl && certs && (
        <div className="col-md-12 mb-3">
          <div className="p-2 bg-light border">
            <Field
              label="CA Cert (optional)"
              textarea
              placeholder={`-----BEGIN CERTIFICATE-----\nMIIE...`}
              minRows={2}
              value={params.caCert || ""}
              name="caCert"
              onChange={onParamChange}
            />
            <Field
              label="Client Cert"
              textarea
              placeholder={`-----BEGIN CERTIFICATE-----\nMIIE...`}
              minRows={2}
              value={params.clientCert || ""}
              name="clientCert"
              onChange={onParamChange}
            />
            <Field
              label="Client Key"
              textarea
              placeholder={`-----BEGIN CERTIFICATE-----\nMIIE...`}
              minRows={2}
              value={params.clientKey || ""}
              name="clientKey"
              onChange={onParamChange}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PrestoForm;
