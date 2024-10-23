import { Flex, Text, Checkbox as RadixCheckbox } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props/margin.props";
import clsx from "clsx";
import HelperText, { getRadixColor } from "@/components/Radix/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";

export type Props = {
  label: string;
  disabled?: boolean;
  disabledMessage?: string;
  value: boolean | "indeterminate";
  error?: string;
  errorLevel?: "error" | "warning";
  description?: string;
  weight?: "bold" | "regular";
  setValue: (value: boolean | "indeterminate") => void;
} & MarginProps;

export default function Checkbox({
  label,
  disabled,
  disabledMessage,
  value,
  setValue,
  description,
  error,
  errorLevel = "error",
  weight = "bold",
  ...containerProps
}: Props) {
  const checkboxColor = error ? getRadixColor(errorLevel) : "violet";

  const TooltipWrapper = ({ children }) =>
    disabledMessage ? (
      <Tooltip body={disabled ? disabledMessage : ""}>{children}</Tooltip>
    ) : (
      children
    );

  return (
    <TooltipWrapper>
      <Text
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
            onCheckedChange={(v) => setValue(v)}
            disabled={disabled}
            color={checkboxColor}
          />
          <Flex direction="column" gap="1">
            <Text weight={weight} className="main-text">
              {label}
            </Text>
            {description && <Text>{description}</Text>}
            {error && <HelperText status={errorLevel}>{error}</HelperText>}
          </Flex>
        </Flex>
      </Text>
    </TooltipWrapper>
  );
}
