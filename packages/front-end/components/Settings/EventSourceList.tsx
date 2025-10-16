import { SchemaFormat } from "back-end/types/datasource";
import React from "react";
import { FaGear } from "react-icons/fa6";
import { SiMixpanel } from "react-icons/si";
import { eventSchema, eventSchemas } from "@/services/eventSchema";
import DataSourceLogo from "@/components/DataSources/DataSourceLogo";
import RadioCards from "@/ui/RadioCards";
import Avatar from "@/ui/Avatar";

export interface Props {
  selected?: SchemaFormat;
  onSelect: (schema: eventSchema) => void;
  allowedSchemas?: SchemaFormat[];
}

export default function EventSourceList({
  onSelect,
  selected,
  allowedSchemas,
}: Props) {
  const options = eventSchemas
    .filter((s) => (allowedSchemas ? allowedSchemas.includes(s.value) : true))
    .map((s) => {
      return {
        value: s.value,
        label: s.label,
        avatar:
          s.value === "mixpanel" ? (
            <SiMixpanel style={{ fontSize: "20px", marginRight: 8 }} />
          ) : (
            <DataSourceLogo eventTracker={s.value} showLabel={false} />
          ),
      };
    });
  options.push({
    value: "custom",
    label: "Custom",
    avatar: (
      <Avatar radius="small" mr="1">
        <FaGear style={{ fontSize: "20px" }} />
      </Avatar>
    ),
  });

  const columns =
    options.length % 3 === 0 ? "3" : options.length % 4 === 0 ? "4" : "3";

  return (
    <RadioCards
      options={options}
      value={selected || ""}
      setValue={(value) => {
        if (value === "custom") {
          onSelect({
            value: "custom",
            label: "Custom",
          } as eventSchema);
        } else {
          const schema = eventSchemas.find((s) => s.value === value);
          if (schema) {
            onSelect(schema);
          }
        }
      }}
      columns={columns}
      align="center"
      width="100%"
    />
  );
}
