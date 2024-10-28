import { DataSourceType } from "back-end/types/datasource";
import { Text } from "@radix-ui/themes";
import { dataSourceConnections } from "@/services/eventSchema";
import RadioCards from "@/components/Radix/RadioCards";

export interface Props {
  value: DataSourceType | "";
  setValue: (value: DataSourceType) => void;
}

export default function DataSourceTypeSelector({ value, setValue }: Props) {
  return (
    <RadioCards
      options={dataSourceConnections
        .filter((o) => o.type !== "google_analytics")
        .map((o) => {
          return {
            value: o.type,
            label: o.display,
            avatar: (
              <Text size={"7"} mr={"1"}>
                {o.icon}
              </Text>
            ),
          };
        })}
      value={value || ""}
      setValue={(value) => {
        setValue(value as DataSourceType);
      }}
      columns={"3"}
      align="center"
    />
  );
}
