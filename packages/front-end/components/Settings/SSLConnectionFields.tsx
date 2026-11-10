import { ChangeEventHandler, useState } from "react";
import { FaCaretDown, FaCaretRight } from "react-icons/fa";
import { Box } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";

type CertField = "caCert" | "clientCert" | "clientKey";

const CERT_FIELDS: { name: CertField; label: string }[] = [
  { name: "caCert", label: "CA Cert (optional)" },
  { name: "clientCert", label: "Client Cert" },
  { name: "clientKey", label: "Client Key" },
];

export interface Props {
  value: {
    ssl: boolean;
    caCert?: string | null;
    clientCert?: string | null;
    clientKey?: string | null;
  };
  setSSL: (ssl: boolean) => void;
  setCertRemoved: (name: CertField, removed: boolean) => void;
  onParamChange: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  existing: boolean;
}

export default function SSLConnectionFields({
  value,
  setSSL,
  setCertRemoved,
  onParamChange,
  existing,
}: Props) {
  const [certs, setCerts] = useState(false);
  // Stored secrets come back redacted to "", while unset ones are absent
  const [stored] = useState(() =>
    CERT_FIELDS.map((f) => f.name).filter(
      (name) => existing && value[name] === "",
    ),
  );
  const certificatePlaceholder = `-----BEGIN CERTIFICATE-----\nMIIE...`;

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
            {existing && (
              <small className="d-block text-muted mb-2">
                Stored certificates are never sent back to the browser. Leave a
                field blank to keep its current value.
              </small>
            )}
            {CERT_FIELDS.map(({ name, label }) =>
              value[name] === null ? (
                <Box mb="3" key={name}>
                  <Text as="label" weight="semibold">
                    {label}
                  </Text>
                  <Text as="div" color="text-mid">
                    The stored value will be removed when you save.{" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setCertRemoved(name, false);
                      }}
                    >
                      Undo
                    </a>
                  </Text>
                </Box>
              ) : (
                <Field
                  key={name}
                  size="legacy"
                  label={label}
                  textarea
                  placeholder={certificatePlaceholder}
                  minRows={2}
                  value={value[name] || ""}
                  name={name}
                  onChange={onParamChange}
                  helpText={
                    stored.includes(name) && !value[name] ? (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setCertRemoved(name, true);
                        }}
                      >
                        Remove stored value
                      </a>
                    ) : undefined
                  }
                />
              ),
            )}
          </div>
        </div>
      )}
    </>
  );
}
