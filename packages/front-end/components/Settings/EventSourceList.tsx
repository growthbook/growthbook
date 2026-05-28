import { SchemaFormat } from "shared/types/datasource";
import React, { useState } from "react";
import { FaGear, FaShareNodes } from "react-icons/fa6";
import { PiCaretRightFill } from "react-icons/pi";
import { SiMixpanel } from "react-icons/si";
import Collapsible from "react-collapsible";
import { eventSchema, eventSchemas } from "@/services/eventSchema";
import DataSourceLogo from "@/components/DataSources/DataSourceLogo";
import RadioCards, { RadioOptions } from "@/ui/RadioCards";
import Avatar from "@/ui/Avatar";

export interface Props {
  selected?: SchemaFormat;
  onSelect: (schema: eventSchema) => void;
  allowedSchemas?: SchemaFormat[];
  featuredSchemas?: SchemaFormat[];
  showEventForwarderOption?: boolean;
  eventForwarderDisabled?: boolean;
  eventForwarderDisabledTooltip?: string;
  onSelectEventForwarder?: () => void;
}

function buildSchemaOption(s: eventSchema) {
  return {
    value: s.value,
    label: s.label,
    description: s.description,
    avatar:
      s.value === "mixpanel" ? (
        <SiMixpanel style={{ fontSize: "20px", marginRight: 8 }} />
      ) : (
        <DataSourceLogo eventTracker={s.value} showLabel={false} />
      ),
  };
}

const customOption = {
  value: "custom",
  label: "Custom",
  description:
    "We have a custom event tracker and we'll write custom SQL statements to tell GrowthBook how to query our data",
  avatar: (
    <Avatar radius="small" mr="1">
      <FaGear style={{ fontSize: "20px" }} />
    </Avatar>
  ),
};

export default function EventSourceList({
  onSelect,
  selected,
  allowedSchemas,
  featuredSchemas,
  showEventForwarderOption,
  eventForwarderDisabled,
  eventForwarderDisabledTooltip,
  onSelectEventForwarder,
}: Props) {
  const [showMore, setShowMore] = useState(false);

  const allSchemaOptions = eventSchemas.filter((s) =>
    allowedSchemas ? allowedSchemas.includes(s.value) : true,
  );

  const useCurated = !!featuredSchemas;

  const featuredSet = new Set(featuredSchemas ?? []);
  const featuredOptions = useCurated
    ? allSchemaOptions.filter((s) => featuredSet.has(s.value))
    : allSchemaOptions;
  const extraOptions = useCurated
    ? allSchemaOptions.filter((s) => !featuredSet.has(s.value))
    : [];

  const eventForwarderOption = showEventForwarderOption
    ? {
        value: "eventForwarder",
        label: "Event Forwarder",
        description:
          "We'll use GrowthBook's Event Forwarder to stream user activity and exposure events to our warehouse in near-real-time",
        avatar: (
          <Avatar radius="small" mr="1">
            <FaShareNodes style={{ fontSize: "20px" }} />
          </Avatar>
        ),
        disabled: eventForwarderDisabled,
        tooltip: eventForwarderDisabled
          ? eventForwarderDisabledTooltip
          : undefined,
      }
    : null;

  const primaryOptions: RadioOptions = [
    ...featuredOptions.map(buildSchemaOption),
    ...(eventForwarderOption ? [eventForwarderOption] : []),
    customOption,
  ];
  console.log("primaryOptions", primaryOptions);

  const additionalOptions: RadioOptions = extraOptions.map(buildSchemaOption);

  const handleSelect = (value: string) => {
    if (value === "eventForwarder") {
      if (eventForwarderDisabled) return;
      onSelectEventForwarder?.();
      return;
    }
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
  };

  const getColumns = (count: number): "3" | "4" =>
    count % 3 === 0 ? "3" : count % 4 === 0 ? "4" : "3";

  const hasAdditionalOptions = useCurated && additionalOptions.length > 0;

  return (
    <>
      <RadioCards
        options={primaryOptions}
        value={selected || ""}
        setValue={handleSelect}
        columns={getColumns(primaryOptions.length)}
        align="start"
        width="100%"
        truncateDescription={false}
      />
      {hasAdditionalOptions ? (
        <div className="mt-3">
          <Collapsible
            trigger={
              <div className="link-purple font-weight-bold mb-2">
                <PiCaretRightFill className="chevron mr-1" />
                Show additional options
              </div>
            }
            open={showMore}
            onOpening={() => setShowMore(true)}
            onClose={() => setShowMore(false)}
            transitionTime={100}
          >
            <div className="rounded p-3 bg-highlight">
              <RadioCards
                options={additionalOptions}
                value={selected || ""}
                setValue={handleSelect}
                columns={getColumns(additionalOptions.length)}
                align="start"
                width="100%"
                truncateDescription={false}
              />
            </div>
          </Collapsible>
        </div>
      ) : null}
    </>
  );
}
