import { RampSchedule, RampScheduleStep } from "shared/types/feature";
import { Box, Flex, IconButton, TextField } from "@radix-ui/themes";
import { PiPlusCircleBold, PiXBold } from "react-icons/pi";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import SelectField from "@/components/Forms/SelectField";
import { decimalToPercent, percentToDecimal } from "@/services/utils";

type HoldUnit = "seconds" | "minutes" | "hours";

const UNIT_MULT: Record<HoldUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
};

// Pick the coarsest unit that evenly represents the stored seconds, so
// round-tripping through the UI doesn't introduce drift.
function inferUnit(holdSeconds: number): HoldUnit {
  if (holdSeconds % 3600 === 0) return "hours";
  if (holdSeconds % 60 === 0) return "minutes";
  return "seconds";
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

const DEFAULT_STEPS: RampScheduleStep[] = [
  { coverage: 0.1, holdSeconds: 600 },
  { coverage: 0.5, holdSeconds: 600 },
];

export interface Props {
  value: RampSchedule | undefined;
  setValue: (value: RampSchedule | undefined) => void;
}

export default function RampScheduleInput({ value, setValue }: Props) {
  const enabled = !!value;
  const steps = value?.steps ?? [];

  const setSteps = (next: RampScheduleStep[]) => setValue({ steps: next });

  const updateStep = (i: number, patch: Partial<RampScheduleStep>) => {
    setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const totalSeconds = steps.reduce((acc, s) => acc + s.holdSeconds, 0);
  const hasShortStep = steps.some((s) => s.holdSeconds < 60);

  return (
    <Box mt="3">
      <Checkbox
        value={enabled}
        setValue={(v) =>
          setValue(v === true ? { steps: DEFAULT_STEPS } : undefined)
        }
        label="Ramp coverage over time"
        description="Advance through percentage steps automatically, then graduate to 100%"
        weight="bold"
      />

      {enabled && (
        <Box mt="3" p="3" className="appbox bg-light">
          <Flex align="center" gap="5" mb="2" pr="6">
            <Box style={{ width: 90 }}>
              <Text size="small" weight="medium" color="text-mid">
                Coverage
              </Text>
            </Box>
            <Text size="small" weight="medium" color="text-mid">
              Hold for
            </Text>
          </Flex>

          {steps.map((step, i) => {
            const unit = inferUnit(step.holdSeconds);
            const amount = step.holdSeconds / UNIT_MULT[unit];
            return (
              <Flex key={i} align="center" gap="2" mb="2">
                <Box style={{ width: 90 }}>
                  <TextField.Root
                    type="number"
                    min={0}
                    max={100}
                    value={decimalToPercent(step.coverage)}
                    onChange={(e) => {
                      let dec = percentToDecimal(e.target.value);
                      if (dec > 1) dec = 1;
                      if (dec < 0) dec = 0;
                      updateStep(i, { coverage: dec });
                    }}
                  >
                    <TextField.Slot side="right">%</TextField.Slot>
                  </TextField.Root>
                </Box>

                <Box style={{ width: 80 }}>
                  <TextField.Root
                    type="number"
                    min={1}
                    value={amount}
                    onChange={(e) => {
                      const n = Math.max(1, parseInt(e.target.value) || 1);
                      updateStep(i, { holdSeconds: n * UNIT_MULT[unit] });
                    }}
                  />
                </Box>

                <Box style={{ width: 120 }}>
                  <SelectField
                    value={unit}
                    options={[
                      { label: "seconds", value: "seconds" },
                      { label: "minutes", value: "minutes" },
                      { label: "hours", value: "hours" },
                    ]}
                    onChange={(v) => {
                      updateStep(i, {
                        holdSeconds: amount * UNIT_MULT[v as HoldUnit],
                      });
                    }}
                  />
                </Box>

                <IconButton
                  type="button"
                  color="gray"
                  variant="ghost"
                  radius="full"
                  size="1"
                  disabled={steps.length <= 1}
                  onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}
                >
                  <PiXBold size={16} />
                </IconButton>
              </Flex>
            );
          })}

          <Flex align="center" gap="2" mb="3">
            <Box style={{ width: 90 }}>
              <Text size="medium" color="text-mid">
                then 100%
              </Text>
            </Box>
            <Text size="small" color="text-low">
              forever
            </Text>
          </Flex>

          <Flex justify="between" align="center">
            <span
              className="link-purple cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                const prev = steps[steps.length - 1];
                setSteps([
                  ...steps,
                  {
                    coverage: Math.min(1, prev.coverage + 0.1),
                    holdSeconds: prev.holdSeconds,
                  },
                ]);
              }}
            >
              <PiPlusCircleBold className="mr-1" />
              Add step
            </span>
            <Text size="small" color="text-mid">
              Total ramp: {formatDuration(totalSeconds)}
            </Text>
          </Flex>

          {hasShortStep && (
            <HelperText status="warning" size="sm" mt="3">
              Steps under 1 minute may not be observed by clients — cron and SDK
              cache TTLs typically run at minute granularity.
            </HelperText>
          )}
        </Box>
      )}
    </Box>
  );
}
