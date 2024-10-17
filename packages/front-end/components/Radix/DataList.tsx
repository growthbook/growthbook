import { ReactNode } from "react";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props";
import { DataList as RadixDataList } from "@radix-ui/themes";
import { RadixColor } from "@/components/Radix/HelperText";

export interface DataListItem {
  label: string;
  color?: RadixColor;
  value: string | ReactNode;
}

export type Props = {
  data: DataListItem[];
  labelWidth?: string;
} & MarginProps;

export default function DataList({
  data,
  labelWidth,
  ...componentProps
}: Props) {
  return (
    <RadixDataList.Root {...componentProps}>
      {data.map(({ label, color, value }, index) => (
        <RadixDataList.Item key={index}>
          <RadixDataList.Label color={color || "gray"} minWidth={labelWidth}>
            {label}
          </RadixDataList.Label>
          <RadixDataList.Value>{value}</RadixDataList.Value>
        </RadixDataList.Item>
      ))}
    </RadixDataList.Root>
  );
}
