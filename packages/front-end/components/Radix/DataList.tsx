import { ReactNode } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Flex, Grid, Text } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Tooltip from "@/components/Tooltip/Tooltip";

export interface DataListItem {
  label: string;
  tooltip?: string;
  value: string | ReactNode;
}

export type Props = {
  data: DataListItem[];
  columns?: 1 | 2 | 3 | 4 | 5;
  maxColumns?: 1 | 2 | 3 | 4 | 5;
  horizontal?: boolean;
  header?: string;
} & MarginProps;

export default function DataList({
  data,
  columns,
  maxColumns = 4,
  horizontal = false,
  header,
  ...componentProps
}: Props) {
  const defaultColumns =
    data.length === 0
      ? 1
      : maxColumns && data.length < maxColumns
      ? (data.length as 1 | 2 | 3 | 4 | 5)
      : maxColumns;

  columns = columns || defaultColumns;

  return (
    <>
      {header && <h4 className="mb-3">{header}</h4>}
      <Grid
        columns={{
          initial: Math.min(columns, 2) + "",
          xs: Math.min(columns, 3) + "",
          sm: columns + "",
        }}
        gapY="6"
        gapX="6"
        {...componentProps}
      >
        {data.map(({ label, value, tooltip }, index) => (
          <Flex direction={horizontal ? "row" : "column"} key={index} gap="2">
            <Text weight="bold">
              {label}
              {tooltip ? (
                <Tooltip body={tooltip}>
                  <Text color="violet" ml="1" size="3">
                    <PiInfo />
                  </Text>
                </Tooltip>
              ) : null}
            </Text>
            <Text>{value}</Text>
          </Flex>
        ))}
      </Grid>
    </>
  );
}
