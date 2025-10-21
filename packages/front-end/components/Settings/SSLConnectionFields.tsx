import { ChangeEventHandler, useState } from "react";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import Field from "@/components/Forms/Field";
import Switch from "@/ui/Switch";

export interface Props {
  value: {
    ssl: boolean;
    caCert?: string;
    clientCert?: string;
    clientKey?: string;
  };
  setSSL: (ssl: boolean) => void;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
}

export default function SSLConnectionFields({
  value,
  setSSL,
  onParamChange,
}: Props) {
  const [certs, setCerts] = useState(false);

  return (
    <>
      <div className="col-md-12">
        <div className="form-group">
          <Switch
            id="require-ssl"
            label="Require SSL"
            value={value.ssl}
            onChange={(ssl) => {
              setSSL(ssl);
            }}
          />
          {value.ssl && (
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
      {value.ssl && certs && (
        <div className="col-md-12 mb-3">
          <div className="p-2 bg-light border">
            <Field
              label="CA Cert (optional)"
              textarea
              placeholder={`-----BEGIN CERTIFICATE-----\nMIIE...`}
              minRows={2}
              value={value.caCert || ""}
              name="caCert"
              onChange={onParamChange}
            />
            <Field
              label="Client Cert"
              textarea
              placeholder={`-----BEGIN CERTIFICATE-----\nMIIE...`}
              minRows={2}
              value={value.clientCert || ""}
              name="clientCert"
              onChange={onParamChange}
            />
            <Field
              label="Client Key"
              textarea
              placeholder={`-----BEGIN CERTIFICATE-----\nMIIE...`}
              minRows={2}
              value={value.clientKey || ""}
              name="clientKey"
              onChange={onParamChange}
            />
          </div>
        </div>
      )}
    </>
  );
}
