import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function EventForwarderTableNameField({
  label = "Event Forwarder Table Name",
  name = "eventForwarderTableName",
  value,
  onChange,
  placeholder,
  tooltip,
  subTitle,
  helpText,
  readOnly = false,
}: {
  label?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  tooltip: string;
  subTitle?: ReactNode;
  helpText?: string;
  readOnly?: boolean;
}) {
  return (
    <Flex direction="column" gap="1">
      <label className="mb-0">
        <Flex direction="column" gap="1" align="start">
          <Flex align="center" gap="1">
            <span>{label}</span>
            <Tooltip body={tooltip} />
          </Flex>
          {subTitle ? (
            <span
              className="form-text text-muted font-weight-normal d-block"
              style={{ fontSize: 14 }}
            >
              {subTitle}
            </span>
          ) : null}
        </Flex>
      </label>
      <Field
        type="text"
        className="form-control"
        name={name}
        value={value}
        onChange={readOnly ? undefined : (e) => onChange(e.target.value)}
        placeholder={placeholder}
        helpText={helpText}
        readOnly={readOnly}
        required={!readOnly}
      />
    </Flex>
  );
}
