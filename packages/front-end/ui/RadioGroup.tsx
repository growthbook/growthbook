import { Flex, Text, RadioGroup as RadixRadioGroup } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { forwardRef, ReactElement } from "react";
import HelperText, { getRadixColor } from "@/ui/HelperText";

export type RadioOptions = {
  value: string;
  label?: string;
  description?: string | JSX.Element;
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
  gap?: string;
  descriptionSize?: "1" | "2" | "3" | "4";
  labelSize?: "1" | "2" | "3" | "4";
} & MarginProps;

export default forwardRef<HTMLDivElement, Props>(function RadioGroup(
  {
    disabled,
    options,
    value,
    setValue,
    gap = "1",
    descriptionSize = "1",
    labelSize = "2",
    ...containerProps
  }: Props,
  ref,
) {
  // get color for selected option
  const selectedOption = options.find((o) => o.value === value);
  const selectedValue = value;
  const radioColor = selectedOption?.error
    ? getRadixColor(selectedOption?.errorLevel ?? "error")
    : "violet";

  return (
    <Flex {...containerProps} ref={ref}>
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
                      <Flex direction="column" gap={gap}>
                        <Text
                          weight="medium"
                          className="main-text"
                          size={labelSize}
                        >
                          {label || value}
                        </Text>
                        {description ? (
                          <Text weight="regular" size={descriptionSize}>
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
              },
            )}
          </RadixRadioGroup.Root>
        </Text>
      </Flex>
    </Flex>
  );
});
