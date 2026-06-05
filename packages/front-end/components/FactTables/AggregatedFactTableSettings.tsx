import { useMemo } from "react";
import { useForm } from "react-hook-form";
import Collapsible from "react-collapsible";
import { PiCaretRightFill } from "react-icons/pi";
import {
  FactTableInterface,
  UpdateFactTableProps,
} from "shared/types/fact-table";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

interface Props {
  factTable: FactTableInterface;
  mutate: () => void;
}

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
  // Make sure whatever is currently saved is always selectable.
  if (currentTimezone && !zones.includes(currentTimezone)) {
    zones = [currentTimezone, ...zones];
  }
  if (!zones.length) {
    zones = [currentTimezone || "UTC"];
  }
  return zones;
}

type FormValues = {
  idTypes: string[];
  time: string;
  timezone: string;
  lookbackWindow: number;
};

export default function AggregatedFactTableSettings({
  factTable,
  mutate,
}: Props) {
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();

  const canEdit = permissionsUtil.canUpdateFactTable(factTable, factTable);

  const existing = factTable.aggregatedFactTableSettings ?? null;
  const defaultTimezone = existing?.updateTime.timezone ?? getDefaultTimezone();

  const form = useForm<FormValues>({
    defaultValues: {
      idTypes: existing?.idTypes ?? [],
      time: existing?.updateTime.time ?? DEFAULT_TIME,
      timezone: defaultTimezone,
      lookbackWindow: existing?.lookbackWindow ?? DEFAULT_LOOKBACK_WINDOW,
    },
  });

  const timezoneOptions = useMemo(
    () => getTimezoneOptions(form.watch("timezone")),
    // Only needs to recompute if the saved timezone changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultTimezone],
  );

  if (!hasCommercialFeature("pipeline-mode")) return null;

  const idTypeOptions = (factTable.userIdTypes || []).map((idType) => ({
    value: idType,
    label: idType,
  }));

  const onSubmit = form.handleSubmit(async (value) => {
    const idTypes = value.idTypes.filter((idType) =>
      factTable.userIdTypes.includes(idType),
    );

    // Clearing all id types disables the pipeline for this fact table.
    const aggregatedFactTableSettings: UpdateFactTableProps["aggregatedFactTableSettings"] =
      idTypes.length
        ? {
            idTypes,
            updateTime: { time: value.time, timezone: value.timezone },
            lookbackWindow: Number(value.lookbackWindow),
          }
        : null;

    await apiCall(`/fact-tables/${factTable.id}`, {
      method: "PUT",
      body: JSON.stringify({ aggregatedFactTableSettings }),
    });
    mutate();
  });

  return (
    <Frame>
      <Collapsible
        trigger={
          <div className="link-purple font-weight-bold">
            <PiCaretRightFill className="chevron mr-1" />
            Advanced Settings
          </div>
        }
        transitionTime={100}
        lazyRender={true}
      >
        <div className="mt-3 rounded px-3 pt-3 pb-1 bg-highlight">
          <Heading as="h4" size="small" mb="1">
            Shared Daily Aggregated Tables
          </Heading>
          <Text as="div" color="text-mid" mb="3">
            A daily job maintains a shared pre-aggregated table for each
            selected identifier type, used to speed up CUPED / regression
            adjustment. Requires the data pipeline to be configured on the data
            source.
          </Text>

          <MultiSelectField
            label="Materialize aggregated tables for"
            labelClassName="font-weight-bold"
            helpText="Select the identifier types (a subset of this fact table's identifiers) to maintain aggregated tables for. Clear all to disable."
            value={(form.watch("idTypes") ?? []).filter((idType) =>
              factTable.userIdTypes.includes(idType),
            )}
            options={idTypeOptions}
            onChange={(value) => form.setValue("idTypes", value)}
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
                {...form.register("time")}
              />
            </div>
            <div className="col">
              <SelectField
                label="Timezone"
                labelClassName="font-weight-bold"
                value={form.watch("timezone")}
                options={timezoneOptions.map((tz) => ({
                  value: tz,
                  label: tz,
                }))}
                onChange={(value) => form.setValue("timezone", value)}
                disabled={!canEdit}
              />
            </div>
          </div>

          <Field
            label="Restate lookback window (days)"
            labelClassName="font-weight-bold"
            helpText="How far back to re-scan when the table is fully restated (e.g. on schema changes)."
            type="number"
            min={1}
            step={1}
            disabled={!canEdit}
            {...form.register("lookbackWindow", { valueAsNumber: true })}
          />

          {canEdit && (
            <div className="mt-2 mb-2">
              <Button onClick={() => onSubmit()}>Save</Button>
            </div>
          )}
        </div>
      </Collapsible>
    </Frame>
  );
}
