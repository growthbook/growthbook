import { ChangeEventHandler, useState } from "react";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";

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
          <label htmlFor="require-ssl" className="mr-2">
            要求使用SSL
          </label>
          <Toggle
            id="require-ssl"
            label="要求使用SSL"
            value={value.ssl}
            setValue={(ssl) => {
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
              高级SSL设置 {certs ? <FaCaretDown /> : <FaCaretRight />}
            </a>
          )}
        </div>
      </div>
      {value.ssl && certs && (
        <div className="col-md-12 mb-3">
          <div className="p-2 bg-light border">
            <Field
              label="CA证书（可选）"
              textarea
              placeholder={`-----BEGIN CERTIFICATE-----\nMIIE...`}
              minRows={2}
              value={value.caCert || ""}
              name="caCert"
              onChange={onParamChange}
            />
            <Field
              label="客户端证书"
              textarea
              placeholder={`-----BEGIN CERTIFICATE-----\nMIIE...`}
              minRows={2}
              value={value.clientCert || ""}
              name="clientCert"
              onChange={onParamChange}
            />
            <Field
              label="客户端密钥"
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
