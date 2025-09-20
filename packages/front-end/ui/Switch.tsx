import { Flex, Switch as RadixSwitch, Text } from "@radix-ui/themes";
import { useId } from "react";
import { PiWarningFill, PiWarningOctagonFill } from "react-icons/pi";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import styles from "./Switch.module.scss";

type UncontrolledSwitchProps = {
  defaultChecked?: boolean;
  checked?: never;
};

type ControlledSwitchProps = {
  defaultChecked?: never;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

type BaseProps = {
  id?: string;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
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

export default function Switch({
  id,
  defaultChecked,
  checked,
  onCheckedChange,
  label,
  description,
  state = "default",
  stateLabel,
  name,
  required,
  disabled,
}: Props) {
  const generatedId = useId();
  const switchId = id ?? generatedId;

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

  return (
    <Flex direction="row" gap="2" data-state={state}>
      <RadixSwitch
        id={switchId}
        size="1"
        disabled={disabled}
        defaultChecked={defaultChecked}
        checked={checked}
        onCheckedChange={onCheckedChange}
        name={name}
        required={required}
        mt="2px"
        mb="2px"
        className={styles.switchRoot}
      />
      <Flex direction="column" gap="1">
        {label && (
          <Text
            as="label"
            htmlFor={switchId}
            size="3"
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
        {label && description && (
          <Text
            size="3"
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
            <Text size="2">{stateLabel}</Text>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
