import { Flex } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function EventForwarderTableNameField({
  label = "Event Forwarder Table Name",
  value,
  onChange,
  placeholder,
  tooltip,
  helpText,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  tooltip: string;
  helpText: string;
}) {
  return (
    <Flex direction="column" gap="1">
      <label className="mb-0">
        <Flex align="center" gap="1">
          <span>{label}</span>
          <Tooltip body={tooltip} />
        </Flex>
      </label>
      <Field
        type="text"
        className="form-control"
        name="eventForwarderTableName"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        helpText={helpText}
        required
      />
    </Flex>
  );
}
