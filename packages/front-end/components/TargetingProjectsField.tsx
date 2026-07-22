import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiInfo, PiPlus } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import RadioGroup from "@/ui/RadioGroup";
import Link from "@/ui/Link";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";

// Controlled targeting-projects editor shared by features, configs, and
// constants (create + edit). Collapsed to a "+ Add" link until opted in (or
// seeded open when a value is already set); then a Specific/All-projects radio
// where "Specific" reveals a full-width project multiselect.
export type TargetingProjectsFieldProps = {
  // Governance project, excluded from the options.
  primaryProject?: string;
  allProjects: boolean;
  setAllProjects: (value: boolean) => void;
  targetingProjects: string[];
  setTargetingProjects: (value: string[]) => void;
  // Noun used in the help tooltip (e.g. "feature", "config", "constant").
  entityLabel?: string;
} & MarginProps;

export default function TargetingProjectsField({
  primaryProject,
  allProjects,
  setAllProjects,
  targetingProjects,
  setTargetingProjects,
  entityLabel = "feature",
  ...marginProps
}: TargetingProjectsFieldProps) {
  const { projects } = useDefinitions();
  const [enabled, setEnabled] = useState<boolean>(
    () => allProjects || targetingProjects.length > 0,
  );

  const help = `Deliver this ${entityLabel} to additional projects.`;

  return (
    <Box {...marginProps}>
      {!enabled ? (
        <Flex align="center" gap="1">
          <Link onClick={() => setEnabled(true)}>
            <PiPlus /> Add targeting projects
          </Link>
          <Tooltip body={help}>
            <PiInfo />
          </Tooltip>
        </Flex>
      ) : (
        <>
          <Flex align="center" gap="1" mb="1">
            <label className="mb-0">Targeting projects</label>
            <Tooltip body={help}>
              <PiInfo />
            </Tooltip>
          </Flex>
          <RadioGroup
            width="100%"
            value={allProjects ? "all" : "specific"}
            setValue={(v) => setAllProjects(v === "all")}
            gap="0"
            options={[
              {
                value: "specific",
                label: "Specific projects",
                renderOutsideItem: true,
                renderOnSelect: (
                  <Box pl="5">
                    <MultiSelectField
                      value={targetingProjects}
                      onChange={setTargetingProjects}
                      options={projects
                        .filter((p) => p.id !== primaryProject)
                        .map((p) => ({ value: p.id, label: p.name }))}
                      placeholder="Select projects..."
                      sort={false}
                      containerClassName="w-full"
                    />
                  </Box>
                ),
              },
              { value: "all", label: "All projects", itemClassName: "mt-2" },
            ]}
          />
        </>
      )}
    </Box>
  );
}
