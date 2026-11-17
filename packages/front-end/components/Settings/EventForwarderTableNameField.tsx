import { ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

// Text field whose label carries an info tooltip
export default function EventForwarderTableNameField({
  label = "Event Forwarder Table Name",
  name = "eventForwarderTableName",
  value,
  onChange,
  placeholder,
  tooltip,
  helpText,
  required = true,
}: {
  label?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  tooltip: string;
  helpText?: ReactNode;
  required?: boolean;
}) {
  return (
    <TextField
      label={
        <Flex align="center" gap="1">
          <Text as="label" htmlFor={name} weight="semibold">
            {label}
          </Text>
          <Tooltip body={tooltip} />
        </Flex>
      }
      id={name}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      helpText={helpText}
      required={required}
    />
  );
}
