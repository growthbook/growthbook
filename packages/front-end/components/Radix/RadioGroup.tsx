import { ReactElement } from "react";
import { Flex, Text, RadioGroup as RadixRadioGroup } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import HelperText, { getRadixColor } from "@/components/Radix/HelperText";

export type Props = {
  disabled?: boolean;
  options: {
    value: string;
    label?: string | ReactElement;
    description?: string | ReactElement;
    sub?: string;
    error?: string;
    errorLevel?: "error" | "warning";
    disabled?: boolean;
  }[];
  value: string;
  setValue: (value: string) => void;
} & MarginProps;

export default function RadioGroup({
  options,
  value,
  setValue,
  disabled,
  ...containerProps
}: Props) {
  // get color for selected option
  const selectedOption = options.find((o) => o.value === value);
  const radioColor = selectedOption?.error
    ? getRadixColor(selectedOption?.errorLevel ?? "error")
    : "violet";

  return (
    <Flex {...containerProps}>
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
              sub,
              disabled,
              error,
              errorLevel = "error",
            }) => {
              return (
                <RadixRadioGroup.Item
                  key={value}
                  value={value}
                  disabled={disabled}
                >
                  <Text color={disabled ? "gray" : undefined}>
                    <Flex direction="column" gap="1">
                      <Text weight="bold">{label || value}</Text>
                      <Flex direction="column" gap="1">
                        {description && (
                          <>
                            <Text weight="regular">{description}</Text>
                            {sub && (
                              <Text size="1" weight="light">
                                {sub}
                              </Text>
                            )}
                          </>
                        )}
                        {error && (
                          <HelperText status={errorLevel}>{error}</HelperText>
                        )}
                      </Flex>
                    </Flex>
                  </Text>
                </RadixRadioGroup.Item>
              );
            }
          )}
        </RadixRadioGroup.Root>
      </Text>
    </Flex>
  );
}
