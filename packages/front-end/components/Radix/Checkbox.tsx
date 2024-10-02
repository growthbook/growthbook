import { Flex, Text, Checkbox as RadixCheckbox } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import HelperText, { getRadixColor } from "@/components/Radix/HelperText";

export type Props = {
  label: string;
  disabled?: boolean;
  value: boolean;
  error?: string;
  errorLevel?: "error" | "warning";
  description?: string;
  setValue: (value: boolean) => void;
} & MarginProps;

export default function Checkbox({
  label,
  disabled,
  value,
  setValue,
  description,
  error,
  errorLevel = "error",
  ...containerProps
}: Props) {
  const checkboxColor = error ? getRadixColor(errorLevel) : "violet";

  return (
    <Text
      as="label"
      size="2"
      color={disabled ? "gray" : undefined}
      {...containerProps}
    >
      <Flex gap="2">
        <RadixCheckbox
          checked={value}
          onCheckedChange={(v) => setValue(v === true)}
          disabled={disabled}
          color={checkboxColor}
        />
        <Flex direction="column" gap="1">
          <Text weight="bold">{label}</Text>
          {description && <Text>{description}</Text>}
          {error && <HelperText status={errorLevel}>{error}</HelperText>}
        </Flex>
      </Flex>
    </Text>
  );
}
