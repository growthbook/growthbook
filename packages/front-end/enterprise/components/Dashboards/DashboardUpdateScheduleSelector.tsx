import { Box } from "@radix-ui/themes";
import { DashboardUpdateSchedule } from "shared/enterprise";
import Field from "@/components/Forms/Field";
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";
import { defaultUpdateSchedules } from "./DashboardModal";

interface Props {
  currentUpdateSchedule: DashboardUpdateSchedule | undefined;
  cronString: string;
  cronError: boolean;
  onHoursChange: (hours: number) => void;
  onCronChange: (cron: string) => void;
  onScheduleTypeChange: (type: keyof typeof defaultUpdateSchedules) => void;
}

export default function DashboardUpdateScheduleSelector({
  currentUpdateSchedule,
  cronString,
  cronError,
  onHoursChange,
  onCronChange,
  onScheduleTypeChange,
}: Props) {
  return (
    <Box width="100%">
      <Box className="appbox p-3">
        <RadioGroup
          options={[
            {
              label: "Refresh results after a specified duration",
              value: "stale",
              description: (
                <Field
                  label="Refresh when"
                  append="hours old"
                  type="number"
                  style={{ width: "180px" }}
                  step={1}
                  min={1}
                  max={168}
                  disabled={currentUpdateSchedule?.type !== "stale"}
                  value={
                    currentUpdateSchedule?.type === "stale"
                      ? currentUpdateSchedule.hours
                      : defaultUpdateSchedules.stale.hours
                  }
                  onChange={(e) => {
                    let hours = 6;
                    try {
                      hours = parseInt(e.target.value);
                    } catch {
                      // pass
                    }
                    onHoursChange(hours);
                  }}
                />
              ),
            },
            {
              label: "Cron Schedule",
              value: "cron",
              description: (
                <>
                  <Text mb="2" as="p">
                    Enter cron string to specify frequency. Minimum once an
                    hour.
                  </Text>
                  <Field
                    disabled={currentUpdateSchedule?.type !== "cron"}
                    value={
                      currentUpdateSchedule?.type === "cron"
                        ? currentUpdateSchedule.cron
                        : defaultUpdateSchedules.cron.cron
                    }
                    onChange={(e) => onCronChange(e.target.value)}
                    helpText={
                      cronError ? (
                        "Invalid cron string"
                      ) : cronString ? (
                        <span className="ml-2">{cronString}</span>
                      ) : (
                        "Example: 0 0 */2 * * *"
                      )
                    }
                  />
                </>
              ),
            },
          ]}
          gap="2"
          descriptionSize="2"
          value={currentUpdateSchedule?.type ?? "stale"}
          setValue={(v) =>
            onScheduleTypeChange(v as keyof typeof defaultUpdateSchedules)
          }
        />
      </Box>
    </Box>
  );
}
