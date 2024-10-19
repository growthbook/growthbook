import { Flex, Text, RadioGroup as RadixRadioGroup } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import { ReactElement } from "react";
import HelperText, { getRadixColor } from "@/components/Radix/HelperText";

export type RadioOptions = {
  value: string;
  label?: string;
  description?: string;
  error?: string;
  errorLevel?: "error" | "warning";
  renderOnSelect?: ReactElement;
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
        <Text size="2" color={disabled ? "gray" : undefined}>
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
                renderOnSelect,
              }) => {
                const selected = value == selectedValue;
                return (
                  <RadixRadioGroup.Item
                    key={value}
                    value={value}
                    disabled={disabled}
                    className={disabled ? "disabled" : undefined}
                  >
                    <Text className={disabled ? "rt-TextDisabled" : undefined}>
                      <Flex direction="column" gap="1">
                        <Text style={{ fontWeight: 500 }} className="main-text">
                          {label || value}
                        </Text>
                        {description ? (
                          <Text weight="regular" size="1">
                            {description}
                          </Text>
                        ) : null}
                        {error && selected ? (
                          <HelperText status={errorLevel}>{error}</HelperText>
                        ) : null}
                        {renderOnSelect && selected ? renderOnSelect : null}
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
