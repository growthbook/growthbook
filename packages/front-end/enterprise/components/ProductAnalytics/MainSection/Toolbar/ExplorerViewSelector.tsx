import type { ComponentType, ReactNode } from "react";
import { Flex } from "@radix-ui/themes";
import { Select, SelectGroup, SelectItem, SelectLabel } from "@/ui/Select";

export type ExplorerViewOption = {
  value: "bar" | "table";
  label: string;
  icon: ComponentType<{ size?: number }>;
};

export default function ExplorerViewSelector({
  items,
  value,
  disabled,
  onChange,
  trailing,
}: {
  items: ExplorerViewOption[];
  value: "bar" | "table";
  disabled?: boolean;
  onChange: (value: "bar" | "table") => void;
  trailing?: ReactNode;
}) {
  return (
    <Flex align="center" gap="2">
      <Select
        size="md"
        value={value}
        placeholder="Select view"
        disabled={disabled}
        setValue={(v) => onChange(v as "bar" | "table")}
      >
        <SelectGroup>
          <SelectLabel>View</SelectLabel>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              <Flex align="center" gap="2">
                <item.icon size={15} /> {item.label}
              </Flex>
            </SelectItem>
          ))}
        </SelectGroup>
      </Select>
      {trailing}
    </Flex>
  );
}
