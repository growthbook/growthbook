import React from "react";
import { Flex, Text } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { DashboardInterface } from "shared/enterprise";
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";

// Radix Select forbids an empty-string item value, so a "no selection"
// option needs its own sentinel that gets translated back to "" here.
const CLEAR_VALUE = "__clear__";

export interface DashboardSelectorProps {
  dashboards: DashboardInterface[];
  defaultDashboard?: DashboardInterface;
  value: string;
  setValue: (value: string) => void;
  canCreate?: boolean;
  onCreateNew?: () => void;
  style?: React.CSSProperties;
  showIcon?: boolean;
  disabled?: boolean;
  // Adds a "no selection" option that calls setValue("") when chosen.
  allowClear?: boolean;
  clearLabel?: string;
}

export default function DashboardSelector({
  dashboards,
  defaultDashboard,
  value,
  setValue,
  canCreate = false,
  onCreateNew,
  style,
  showIcon = true,
  disabled = false,
  allowClear = false,
  clearLabel = "None",
}: DashboardSelectorProps) {
  return (
    <Select
      style={{
        minWidth: "200px",
        ...style,
      }}
      value={allowClear && !value ? CLEAR_VALUE : value}
      setValue={(newValue) => {
        if (newValue === "__create__") {
          onCreateNew?.();
          return;
        }
        if (newValue === CLEAR_VALUE) {
          setValue("");
          return;
        }
        setValue(newValue);
      }}
      disabled={disabled}
    >
      {allowClear && (
        <>
          <SelectItem value={CLEAR_VALUE}>
            <Text color="gray">{clearLabel}</Text>
          </SelectItem>
          <SelectSeparator />
        </>
      )}
      {defaultDashboard && (
        <>
          <SelectItem value={defaultDashboard.id}>
            <OverflowText maxWidth={400}>{defaultDashboard.title}</OverflowText>
          </SelectItem>
          <SelectSeparator />
        </>
      )}
      {dashboards.map((dash) =>
        dash.id === defaultDashboard?.id ? null : (
          <SelectItem key={dash.id} value={dash.id}>
            <OverflowText maxWidth={400}>{dash.title}</OverflowText>
          </SelectItem>
        ),
      )}
      {canCreate && (
        <>
          {dashboards.length > 0 && <SelectSeparator />}
          <SelectItem value="__create__">
            <Flex align="center">
              {showIcon && <PiPlus className="rt-SelectItemIndicator" />}
              <Text weight="regular">Create new dashboard</Text>
            </Flex>
          </SelectItem>
        </>
      )}
    </Select>
  );
}
