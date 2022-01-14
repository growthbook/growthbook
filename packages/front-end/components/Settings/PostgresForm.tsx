import { FC, ChangeEventHandler, useState } from "react";
import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import { isCloud } from "../../services/env";
import Toggle from "../Forms/Toggle";
import Field from "../Forms/Field";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";

const PostgresForm: FC<{
  params: Partial<PostgresConnectionParams>;
  existing: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  setParams: (params: { [key: string]: string }) => void;
}> = ({ params, existing, onParamChange, setParams }) => {
  const [certs, setCerts] = useState(false);

  return (
    <>
      {isCloud() ? (
        <div className="row">
          <div className="col-auto">
            <div className="alert alert-info">
              Make sure to whitelist the IP Address <code>52.70.79.40</code> so
              GrowthBook can reach your database.
            </div>
          </div>
        </div>
      ) : null}
      <div className="row">
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
            type="password"
            className="form-control"
            name="password"
            required={!existing}
            value={params.password || ""}
            onChange={onParamChange}
            placeholder={existing ? "(Keep existing)" : ""}
          />
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
        <div className="col-md-12">
          <div className="form-group">
            <label htmlFor="require-ssl" className="mr-2">
              Require SSL
            </label>
            <Toggle
              id="require-ssl"
              label="Require SSL"
              value={params.ssl === true || params.ssl === "true"}
              setValue={(value) => {
                setParams({
                  ssl: value ? "true" : "",
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
                Advanced SSL Settings{" "}
                {certs ? <FaCaretDown /> : <FaCaretRight />}
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
    </>
  );
};

export default PostgresForm;
