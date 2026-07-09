import { useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
import {
  CreateFactTableProps,
  FactTableInterface,
} from "shared/types/fact-table";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";

const DEFAULT_TIME = "02:00";
const DEFAULT_LOOKBACK_WINDOW = 60;

function getDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function getTimezoneOptions(currentTimezone: string): string[] {
  let zones: string[] = [];
  if (typeof Intl.supportedValuesOf === "function") {
    zones = Intl.supportedValuesOf("timeZone");
  }
  if (currentTimezone && !zones.includes(currentTimezone)) {
    zones = [currentTimezone, ...zones];
  }
  if (!zones.length) {
    zones = [currentTimezone || "UTC"];
  }
  return zones;
}

// Default form values so the nested fields always exist; the modal nulls these
// out at submit time when no id types are selected (disabling the pipeline).
export function getAggregatedFactTableSettingsFormDefault(
  existing?: FactTableInterface,
): NonNullable<CreateFactTableProps["aggregatedFactTableSettings"]> {
  const settings = existing?.aggregatedFactTableSettings ?? null;
  return {
    idTypes: settings?.idTypes ?? [],
    updateTime: {
      time: settings?.updateTime.time ?? DEFAULT_TIME,
      timezone: settings?.updateTime.timezone ?? getDefaultTimezone(),
    },
    lookbackWindow: settings?.lookbackWindow ?? DEFAULT_LOOKBACK_WINDOW,
  };
}

interface Props {
  form: UseFormReturn<CreateFactTableProps>;
  userIdTypes: string[];
  canEdit: boolean;
}

export default function AggregatedFactTableSettings({
  form,
  userIdTypes,
  canEdit,
}: Props) {
  const timezone =
    form.watch("aggregatedFactTableSettings.updateTime.timezone") || "UTC";

  const timezoneOptions = useMemo(
    () => getTimezoneOptions(timezone),
    [timezone],
  );

  const idTypeOptions = userIdTypes.map((idType) => ({
    value: idType,
    label: idType,
  }));

  const selectedIdTypes = (
    form.watch("aggregatedFactTableSettings.idTypes") ?? []
  ).filter((idType) => userIdTypes.includes(idType));

  return (
    <>
      <Heading as="h4" size="small" mb="1">
        [Experimental] Daily Aggregated Tables
      </Heading>
      <Text as="div" color="text-mid" mb="3">
        Configure a daily job to pre-aggregate metric values in this table. Used
        to speed up CUPED in the incremental refresh pipeline mode.
      </Text>

      <MultiSelectField
        label="Materialize aggregated tables for"
        labelClassName="font-weight-bold"
        helpText="Tables are aggregated by identifier type and only experiments using these identifier types will be able to use the aggregated tables for CUPED. Clear all to disable."
        value={selectedIdTypes}
        options={idTypeOptions}
        onChange={(value) =>
          form.setValue("aggregatedFactTableSettings.idTypes", value)
        }
        placeholder="Select identifier types..."
        disabled={!canEdit}
      />

      <div className="row">
        <div className="col-auto">
          <Field
            label="Daily update time"
            labelClassName="font-weight-bold"
            type="time"
            disabled={!canEdit}
            {...form.register("aggregatedFactTableSettings.updateTime.time")}
          />
        </div>
        <div className="col">
          <SelectField
            label="Timezone"
            labelClassName="font-weight-bold"
            value={timezone}
            options={timezoneOptions.map((tz) => ({
              value: tz,
              label: tz,
            }))}
            onChange={(value) =>
              form.setValue(
                "aggregatedFactTableSettings.updateTime.timezone",
                value,
              )
            }
            disabled={!canEdit}
          />
        </div>
      </div>

      <Field
        label="Restate lookback window (days)"
        labelClassName="font-weight-bold"
        helpText="How far back to re-scan when the table is fully restated (e.g. on schema changes). Leave it longer than your typical regression window to allow for experiments with older start dates to still benefit from the aggregated tables. Also the default retention window for the table is set to this value. If this value changes, however, the retention window on any existing tables will only change when the table is fully restated."
        type="number"
        min={1}
        step={1}
        disabled={!canEdit}
        {...form.register("aggregatedFactTableSettings.lookbackWindow", {
          valueAsNumber: true,
        })}
      />
    </>
  );
}
