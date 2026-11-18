import { ReactNode } from "react";
import LabelWithHelp from "@/ui/LabelWithHelp";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

export default function TextFieldWithHelp({
  label,
  name,
  value,
  onChange,
  placeholder,
  tooltip,
  helpText,
  required = true,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  tooltip: string;
  helpText?: ReactNode;
  required?: boolean;
}) {
  return (
    <TextField
      label={
        <Text as="label" htmlFor={name} weight="semibold">
          <LabelWithHelp label={label} help={tooltip} />
        </Text>
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
