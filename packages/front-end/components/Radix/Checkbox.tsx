import { Flex, Text, Checkbox as RadixCheckbox } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import clsx from "clsx";
import { forwardRef, ReactElement } from "react";
import { Responsive } from "@radix-ui/themes/dist/esm/props/prop-def.js";
import HelperText, { getRadixColor } from "@/components/Radix/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";

export type Size = "md" | "lg";

export function getRadixSize(size: Size): Responsive<"2" | "3"> {
  switch (size) {
    case "md":
      return "2";
    case "lg":
      return "3";
  }
}

export type Props = {
  label?: string | ReactElement;
  id?: string;
  disabled?: boolean;
  disabledMessage?: string;
  value: boolean | "indeterminate";
  size?: Size;
  error?: string;
  errorLevel?: "error" | "warning";
  description?: string;
  weight?: "bold" | "regular";
  setValue: (value: boolean) => void;
  required?: boolean;
} & MarginProps;

export default forwardRef<HTMLLabelElement, Props>(function Checkbox(
  {
    label,
    id,
    disabled,
    disabledMessage,
    value,
    size = "md",
    setValue,
    description,
    error,
    errorLevel = "error",
    weight = "bold",
    required,
    ...containerProps
  }: Props,
  ref
) {
  const checkboxColor = error ? getRadixColor(errorLevel) : "violet";

  const TooltipWrapper = ({ children }) =>
    disabledMessage ? (
      <Tooltip
        body={disabled ? disabledMessage : ""}
        popperStyle={{ wordBreak: "normal" }}
      >
        {children}
      </Tooltip>
    ) : (
      children
    );

  return (
    <TooltipWrapper>
      <Text
        ref={ref}
        as="label"
        size="2"
        className={clsx("rt-CheckboxItem", {
          "rt-TextDisabled": disabled,
          disabled: disabled,
        })}
        {...containerProps}
      >
        <Flex gap="2">
          <RadixCheckbox
            checked={value}
            onCheckedChange={(v) => setValue(!!v)}
            disabled={disabled}
            color={checkboxColor}
            size={getRadixSize(size)}
            id={id}
            required={required}
          />
          <Flex direction="column" gap="1">
            <Text weight={weight}>{label}</Text>
            {description && <Text>{description}</Text>}
            {error && <HelperText status={errorLevel}>{error}</HelperText>}
          </Flex>
        </Flex>
      </Text>
    </TooltipWrapper>
  );
});
