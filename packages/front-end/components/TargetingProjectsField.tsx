import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiInfo, PiPlusBold } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import RadioGroup from "@/ui/RadioGroup";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import MultiSelectField from "@/ui/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";

// Controlled targeting-projects editor shared by features, configs, and constants.
// Collapsed to a link until opted in; then a Specific/All-projects radio.
export type TargetingProjectsFieldProps = {
  // Governance project, excluded from the options.
  primaryProject?: string;
  allProjects: boolean;
  setAllProjects: (value: boolean) => void;
  targetingProjects: string[];
  setTargetingProjects: (value: string[]) => void;
  // Noun for the help tooltip (e.g. "feature", "config", "constant").
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

  const help = `Also include this ${entityLabel} in these projects' SDK payloads`;

  return (
    <Box {...marginProps}>
      {!enabled ? (
        <Box display="inline-block">
          <Link
            type="button"
            className="hover-underline"
            onClick={() => setEnabled(true)}
          >
            <PiPlusBold className="mr-1" />
            Targeting projects
            <Tooltip body={<Text as="div">{help}</Text>}>
              <PiInfo color="var(--color-text-low)" className="ml-1" />
            </Tooltip>
          </Link>
        </Box>
      ) : (
        <>
          <Flex align="center" gap="1" mb="3">
            <label className="mb-0" style={{ fontWeight: 600 }}>
              Additional Targeting Projects
            </label>
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
                label: "Specific Projects",
                renderOutsideItem: true,
                renderOnSelect: (
                  <Box pl="5">
                    <MultiSelectField
                      value={targetingProjects}
                      onChange={setTargetingProjects}
                      options={projects
                        .filter((p) => p.id !== primaryProject)
                        .map((p) => ({ value: p.id, label: p.name }))}
                      placeholder="No projects selected"
                      sort={false}
                      containerClassName="w-full"
                    />
                  </Box>
                ),
              },
              { value: "all", label: "All Projects", itemClassName: "mt-2" },
            ]}
          />
        </>
      )}
    </Box>
  );
}
