import { Flex, Text, RadioGroup as RadixRadioGroup } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { forwardRef, Fragment, ReactElement } from "react";
import HelperText, { getRadixColor } from "@/ui/HelperText";

export type RadioOptions = {
  value: string;
  label?: string;
  description?: string | JSX.Element;
  error?: string;
  errorLevel?: "error" | "warning";
  renderOnSelect?: ReactElement;
  /**
   * When true, `renderOnSelect` is rendered as a sibling after the radio item
   * rather than inside the label element. Use this when the disclosed content
   * contains interactive elements (dropdowns, inputs) that must not be wrapped
   * in a `<label>`.
   */
  renderOutsideItem?: boolean;
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
  width?: string | number;
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
    width,
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
    <Flex style={width != null ? { width } : undefined} {...containerProps} ref={ref}>
      <Flex direction={"column"} style={width != null ? { width } : undefined}>
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
                renderOutsideItem = false,
              }) => {
                const selected = value == selectedValue;
                return (
                  <Fragment key={value}>
                    <RadixRadioGroup.Item
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
                          {!renderOutsideItem && renderOnSelect && selected
                            ? renderOnSelect
                            : null}
                        </Flex>
                      </Text>
                    </RadixRadioGroup.Item>
                    {renderOutsideItem && renderOnSelect && selected
                      ? renderOnSelect
                      : null}
                  </Fragment>
                );
              },
            )}
          </RadixRadioGroup.Root>
        </Text>
      </Flex>
    </Flex>
  );
});
