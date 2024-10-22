import { ReactNode } from "react";
import { MarginProps } from "@radix-ui/themes/dist/cjs/props";
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
  columns?: 1 | 2 | 3 | 4;
  header?: string;
} & MarginProps;

export default function DataList({
  data,
  columns,
  header,
  ...componentProps
}: Props) {
  const defaultColumns =
    data.length === 1 ? 1 : data.length === 2 ? 2 : data.length === 3 ? 3 : 4;

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
          <Flex direction="column" key={index}>
            <Text weight="bold" mb="2">
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
