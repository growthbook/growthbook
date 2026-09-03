import { Flex, Text, Checkbox as RadixCheckbox } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import clsx from "clsx";
import { forwardRef, ReactElement } from "react";
import HelperText, { getRadixColor } from "@/ui/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";
import RadixTooltip from "@/ui/Tooltip";
import { radixSize, Size as SharedSize } from "@/ui/sizes";

export type Size = SharedSize<"sm" | "md" | "lg">;

export type Props = {
  label?: string | ReactElement;
  labelSize?: SharedSize<"sm" | "md" | "lg">;
  id?: string;
  disabled?: boolean;
  disabledMessage?: string;
  value: boolean | "indeterminate";
  size?: Size;
  checkboxTooltip?: string;
  error?: string;
  errorLevel?: "error" | "warning";
  description?: string | ReactElement;
  weight?: "bold" | "regular" | "medium";
  setValue: (value: boolean) => void;
  required?: boolean;
  containerClassName?: string;
} & MarginProps;

export default forwardRef<HTMLLabelElement, Props>(function Checkbox(
  {
    label,
    labelSize = "md",
    id,
    disabled,
    disabledMessage,
    value,
    size = "md",
    checkboxTooltip,
    setValue,
    description,
    error,
    errorLevel = "error",
    weight = "bold",
    required,
    containerClassName,
    ...containerProps
  }: Props,
  ref,
) {
  const checkboxColor = error ? getRadixColor(errorLevel) : "violet";

  const checkboxEl = (
    <RadixCheckbox
      checked={value}
      onCheckedChange={(v) => setValue(!!v)}
      disabled={disabled}
      color={checkboxColor}
      size={radixSize(size)}
      id={id}
      required={required}
    />
  );

  const labelEl = (
    <Text
      ref={ref}
      as="label"
      size={radixSize(labelSize)}
      mb="0"
      className={clsx(
        "rt-CheckboxItem",
        {
          "rt-TextDisabled": disabled,
          disabled: disabled,
        },
        containerClassName,
      )}
      {...containerProps}
    >
      <Flex gap="2">
        {checkboxTooltip && !disabled ? (
          <RadixTooltip content={checkboxTooltip} side="top" maxWidth="240px">
            {checkboxEl}
          </RadixTooltip>
        ) : (
          checkboxEl
        )}
        <Flex direction="column" gap="1">
          <Text weight={weight}>{label}</Text>
          {description && (
            <Text weight="regular" style={{ color: "var(--color-text-mid)" }}>
              {description}
            </Text>
          )}
          {error && <HelperText status={errorLevel}>{error}</HelperText>}
        </Flex>
      </Flex>
    </Text>
  );

  if (disabled && disabledMessage) {
    return (
      <Tooltip
        body={disabledMessage}
        popperStyle={{ wordBreak: "normal" }}
        tipMinWidth="140px"
      >
        {labelEl}
      </Tooltip>
    );
  }

  return labelEl;
});
