import {
  Flex,
  Grid,
  Text,
  Switch as RadixSwitch,
  type SwitchProps as RadixSwitchProps,
} from "@radix-ui/themes";
import { useId, forwardRef } from "react";
import { PiWarningFill, PiWarningOctagonFill } from "react-icons/pi";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import styles from "./Switch.module.scss";

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
  size?: "1" | "2" | "3";
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
    size = "2",
    required,
    disabled,
    ...props
  }: Props,
  ref,
) {
  const generatedId = useId();
  const switchId = id ?? generatedId;

  function getSwitchSize() {
    switch (size) {
      case "1":
      case "2":
        return "1";
      case "3":
        return "2";
    }
  }

  function getTextSize() {
    switch (size) {
      case "1":
        return "1";
      case "2":
        return "2";
      case "3":
        return "3";
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
          size={getTextSize()}
          style={{
            fontWeight: 500,
            color: disabled
              ? "var(--color-text-disabled)"
              : "var(--color-text-high)",
            // Override bootstrap _reboot default
            marginBottom: 0,
          }}
        >
          {label}
        </Text>
      )}
      {((label && description) || (state !== "default" && stateLabel)) && (
        <Flex gridArea="description" direction="column" gap="1">
          {label && description && (
            <Text
              size={getTextSize()}
              style={{
                color: disabled
                  ? "var(--color-text-disabled)"
                  : "var(--color-text-mid)",
              }}
            >
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
              <Text size={getTextSize()}>{stateLabel}</Text>
            </Flex>
          )}
        </Flex>
      )}
    </Grid>
  );
});

export default Switch;
