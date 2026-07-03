import { Box, Flex } from "@radix-ui/themes";
import DatePicker from "@/components/DatePicker";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Text from "@/ui/Text";
import { useDefinitions } from "@/services/DefinitionsContext";
import { experimentDateRanges as dateRanges } from "@/components/ExecReports/dateRanges";

export interface CompletedExperimentsFilterValue {
  dateRange: string;
  startDate?: string;
  endDate?: string;
  projects: string[];
}

interface Props {
  value: CompletedExperimentsFilterValue;
  onChange: (patch: Partial<CompletedExperimentsFilterValue>) => void;
  // Restrict the project options (e.g. to the dashboard's projects). Empty
  // means all org projects are selectable.
  availableProjects?: string[];
}

// Shared date-range + project scoping controls for the "Completed Experiments"
// block settings editors (Scaled Impact, Win Percentage, Experiment Status).
export default function CompletedExperimentsFilterFields({
  value,
  onChange,
  availableProjects,
}: Props) {
  const { projects } = useDefinitions();

  const projectOptions = (
    availableProjects && availableProjects.length > 0
      ? projects.filter((p) => availableProjects.includes(p.id))
      : projects
  ).map((p) => ({ label: p.name, value: p.id }));

  return (
    <>
      <Box>
        <Box mb="2">
          <Text weight="semibold">Date Range</Text>
        </Box>
        <SelectField
          options={dateRanges}
          sort={false}
          value={value.dateRange}
          onChange={(v) => {
            if (v === "custom") {
              // Seed the custom window from the current preset so the pickers
              // start somewhere sensible.
              const end = new Date();
              const start = new Date();
              start.setDate(
                start.getDate() - (parseInt(value.dateRange, 10) || 90),
              );
              onChange({
                dateRange: "custom",
                startDate: value.startDate ?? start.toISOString(),
                endDate: value.endDate ?? end.toISOString(),
              });
            } else {
              onChange({
                dateRange: v,
                startDate: undefined,
                endDate: undefined,
              });
            }
          }}
        />
        {value.dateRange === "custom" && (
          <Flex gap="4" mt="2" wrap="wrap">
            <Flex align="center" gap="2">
              <Text size="small">From</Text>
              <DatePicker
                date={value.startDate ? new Date(value.startDate) : undefined}
                setDate={(d) => d && onChange({ startDate: d.toISOString() })}
                scheduleEndDate={
                  value.endDate ? new Date(value.endDate) : undefined
                }
                precision="date"
                containerClassName=""
              />
            </Flex>
            <Flex align="center" gap="2">
              <Text size="small">To</Text>
              <DatePicker
                date={value.endDate ? new Date(value.endDate) : undefined}
                setDate={(d) => d && onChange({ endDate: d.toISOString() })}
                scheduleStartDate={
                  value.startDate ? new Date(value.startDate) : undefined
                }
                precision="date"
                containerClassName=""
              />
            </Flex>
          </Flex>
        )}
      </Box>

      <Box>
        <Box mb="2">
          <Text weight="semibold">Projects</Text>
        </Box>
        <MultiSelectField
          value={value.projects}
          options={projectOptions}
          onChange={(v) => onChange({ projects: v })}
          placeholder="All projects"
        />
      </Box>
    </>
  );
}
