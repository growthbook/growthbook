import { DataSourceType } from "shared/types/datasource";

import { dataSourceConnections } from "@/services/eventSchema";
import RadioCards from "@/ui/RadioCards";
import Text from "@/ui/Text";

export interface Props {
  value: DataSourceType | "";
  setValue: (value: DataSourceType) => void;
}

export default function DataSourceTypeSelector({ value, setValue }: Props) {
  return (
    <RadioCards
      options={dataSourceConnections
        .filter((o) => o.type !== "google_analytics" && o.type !== "mixpanel")
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
      width="100%"
    />
  );
}
