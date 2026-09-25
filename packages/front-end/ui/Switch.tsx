import {
  Flex,
  Grid,
  Switch as RadixSwitch,
  type SwitchProps as RadixSwitchProps,
} from "@radix-ui/themes";
import { useId, forwardRef } from "react";
import { PiWarningFill, PiWarningOctagonFill } from "react-icons/pi";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Size } from "@/ui/sizes";
import styles from "./Switch.module.scss";
import Text from "./Text";

type UncontrolledSwitchProps = {
  defaultValue?: boolean;
  value?: never;
  onChange?: (checked: boolean) => void;
};

type ControlledSwitchProps = {
  defaultValue?: never;
  value: boolean;
  onChange: (checked: boolean) => void;
};

type BaseProps = {
  color?: RadixSwitchProps["color"];
  id?: string;
  label?: React.ReactNode;
  size?: Size<"sm" | "md" | "lg">;
  description?: string;
  state?: "default" | "warning" | "error";
  // stateLabel is only rendered if state is not default
  stateLabel?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
};

export type Props = (UncontrolledSwitchProps | ControlledSwitchProps) &
  BaseProps &
  MarginProps;

const Switch = forwardRef<HTMLButtonElement, Props>(function Switch(
  {
    color,
    id,
    defaultValue,
    value,
    onChange,
    label,
    description,
    state = "default",
    stateLabel,
    name,
    size = "md",
    required,
    disabled,
    ...props
  }: Props,
  ref,
) {
  const generatedId = useId();
  const switchId = id ?? generatedId;

  // Not radixSize: Switch compresses the ladder, so sm and md both render
  // Radix "1" and lg renders "2". Radix Switch's own "3" goes unused.
  function getSwitchSize() {
    switch (size) {
      case "sm":
      case "md":
        return "1";
      case "lg":
        return "2";
    }
  }

  function getStateColor(state: "default" | "warning" | "error") {
    switch (state) {
      case "warning":
        return "var(--amber-11)";
      case "error":
        return "var(--red-11)";
      case "default":
        return "var(--color-text-mid)";
    }
  }

  function getStateIcon(state: "default" | "warning" | "error") {
    switch (state) {
      case "warning":
        return <PiWarningFill />;
      case "error":
        return <PiWarningOctagonFill />;
      case "default":
        return null;
    }
  }

  function getGridAreas() {
    if (label && description) {
      return "'switch label' '. description'";
    }
    if (state !== "default" && stateLabel) {
      return "'switch label' '. description'";
    }
    if (label) {
      return "'switch label'";
    }
    return "'switch'";
  }

  return (
    <Grid
      areas={getGridAreas()}
      columns={label ? "auto 1fr" : "auto"}
      align="center"
      gapX="2"
      gapY="1"
      data-state={state}
      {...props}
    >
      <RadixSwitch
        ref={ref}
        color={color}
        id={switchId}
        size={getSwitchSize()}
        disabled={disabled}
        defaultChecked={defaultValue}
        checked={value}
        onCheckedChange={onChange}
        name={name}
        required={required}
        className={styles.switchRoot}
      />
      {label && (
        <Text
          as="label"
          htmlFor={switchId}
          size={size}
          weight="medium"
          color={disabled ? "text-disabled" : "text-high"}
          mb="0"
        >
          {label}
        </Text>
      )}
      {((label && description) || (state !== "default" && stateLabel)) && (
        <Flex gridArea="description" direction="column" gap="1">
          {label && description && (
            <Text size={size} color={disabled ? "text-disabled" : "text-mid"}>
              {description}
            </Text>
          )}
          {state !== "default" && stateLabel && (
            <Flex
              direction="row"
              gap="1"
              align="center"
              style={{
                color: disabled
                  ? "var(--color-text-disabled)"
                  : getStateColor(state),
              }}
            >
              {getStateIcon(state)}
              <Text size={size}>{stateLabel}</Text>
            </Flex>
          )}
        </Flex>
      )}
    </Grid>
  );
});

export default Switch;
