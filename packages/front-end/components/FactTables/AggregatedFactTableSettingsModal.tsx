import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import {
  CreateFactTableProps,
  FactTableInterface,
} from "shared/types/fact-table";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

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

type Settings = NonNullable<
  CreateFactTableProps["aggregatedFactTableSettings"]
>;

export default function AggregatedFactTableSettingsModal({
  factTable,
  close,
}: {
  factTable: FactTableInterface;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const { mutateDefinitions } = useDefinitions();

  const settings = factTable.aggregatedFactTableSettings ?? null;
  const form = useForm<{ aggregatedFactTableSettings: Settings }>({
    defaultValues: {
      aggregatedFactTableSettings: {
        idTypes: settings?.idTypes ?? [],
        updateTime: {
          time: settings?.updateTime.time ?? DEFAULT_TIME,
          timezone: settings?.updateTime.timezone ?? getDefaultTimezone(),
        },
        lookbackWindow: settings?.lookbackWindow ?? DEFAULT_LOOKBACK_WINDOW,
      },
    },
  });

  const timezone =
    form.watch("aggregatedFactTableSettings.updateTime.timezone") || "UTC";

  const timezoneOptions = useMemo(
    () => getTimezoneOptions(timezone),
    [timezone],
  );

  const selectedIdTypes = form
    .watch("aggregatedFactTableSettings.idTypes")
    .filter((idType) => factTable.userIdTypes.includes(idType));

  return (
    <ModalStandard
      trackingEventModalType=""
      header="[Experimental] Daily Aggregated Tables"
      open={true}
      close={close}
      cta="Save"
      submit={validatedSubmit(form, async ({ aggregatedFactTableSettings }) => {
        const { updateTime, lookbackWindow } = aggregatedFactTableSettings;
        // Clearing all id types disables the aggregated pipeline.
        await apiCall(`/fact-tables/${factTable.id}`, {
          method: "PUT",
          body: JSON.stringify({
            aggregatedFactTableSettings: selectedIdTypes.length
              ? {
                  idTypes: selectedIdTypes,
                  updateTime,
                  lookbackWindow: Number(lookbackWindow),
                }
              : null,
          }),
        });
        await mutateDefinitions();
      })}
    >
      <Text as="div" color="text-mid" mb="3">
        Configure a daily job to pre-aggregate metric values in this table. Used
        to speed up CUPED in the incremental refresh pipeline mode.
      </Text>

      <MultiSelectField
        label="Materialize aggregated tables for"
        labelClassName="font-weight-bold"
        helpText="Tables are aggregated by identifier type and only experiments using these identifier types will be able to use the aggregated tables for CUPED. Clear all to disable."
        value={selectedIdTypes}
        options={factTable.userIdTypes.map((idType) => ({
          value: idType,
          label: idType,
        }))}
        onChange={(value) =>
          form.setValue("aggregatedFactTableSettings.idTypes", value)
        }
        placeholder="Select identifier types..."
      />

      <Flex gap="3">
        <Box>
          <Field
            label="Daily update time"
            labelClassName="font-weight-bold"
            type="time"
            {...form.register("aggregatedFactTableSettings.updateTime.time")}
          />
        </Box>
        <Box flexGrow="1">
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
          />
        </Box>
      </Flex>

      <Field
        label="Restate lookback window (days)"
        labelClassName="font-weight-bold"
        helpText="How far back to re-scan when the table is fully restated (e.g. on schema changes). Leave it longer than your typical regression window to allow for experiments with older start dates to still benefit from the aggregated tables. Also the default retention window for the table is set to this value. If this value changes, however, the retention window on any existing tables will only change when the table is fully restated."
        type="number"
        min={1}
        step={1}
        {...form.register("aggregatedFactTableSettings.lookbackWindow", {
          valueAsNumber: true,
        })}
      />
    </ModalStandard>
  );
}
