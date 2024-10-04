import { Flex, Text, RadioGroup as RadixRadioGroup } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import HelperText, { getRadixColor } from "@/components/Radix/HelperText";

export type RadioOptions = {
  value: string;
  label?: string;
  description?: string;
  error?: string;
  errorLevel?: "error" | "warning";
  disabled?: boolean;
}[];

export type Props = {
  disabled?: boolean;
  options: RadioOptions;
  value: string;
  setValue: (value: string) => void;
} & MarginProps;

export default function RadioGroup({
  disabled,
  options,
  value,
  setValue,
  ...containerProps
}: Props) {
  // get color for selected option
  const selectedOption = options.find((o) => o.value === value);
  const selectedValue = value;
  const radioColor = selectedOption?.error
    ? getRadixColor(selectedOption?.errorLevel ?? "error")
    : "violet";

  return (
    <Flex {...containerProps}>
      <Flex direction={"column"}>
        <Text as="label" size="2" color={disabled ? "gray" : undefined}>
          <RadixRadioGroup.Root
            value={value}
            onValueChange={(val) => setValue(val)}
            disabled={disabled}
            color={radioColor}
          >
            {options.map(
              ({
                value,
                label,
                description,
                disabled,
                error,
                errorLevel = "error",
              }) => {
                const selected = value == selectedValue;
                return (
                  <RadixRadioGroup.Item
                    key={value}
                    value={value}
                    disabled={disabled}
                  >
                    <Text color={disabled ? "gray" : undefined}>
                      <Flex direction="column" gap="1">
                        <Text weight="bold">{label || value}</Text>
                        {description && (
                          <Text weight="regular">{description}</Text>
                        )}
                        {error && selected ? (
                          <HelperText status={errorLevel}>{error}</HelperText>
                        ) : null}
                      </Flex>
                    </Text>
                  </RadixRadioGroup.Item>
                );
              }
            )}
          </RadixRadioGroup.Root>
        </Text>
      </Flex>
    </Flex>
  );
}
