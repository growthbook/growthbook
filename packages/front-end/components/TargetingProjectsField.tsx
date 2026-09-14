import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiInfo, PiPlusBold, PiX } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import RadioGroup from "@/ui/RadioGroup";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import MultiSelectField from "@/ui/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";

// Controlled targeting-projects editor. Collapsed to a link until opted in;
// then a Specific/All-projects radio. Options are limited to Projects the
// viewer may target (plus any already selected, so they can be removed), the
// same way the primary Project picker is limited to where they may edit.
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
  const permissionsUtil = usePermissionsUtil();
  const [enabled, setEnabled] = useState<boolean>(
    () => allProjects || targetingProjects.length > 0,
  );

  const options = projects.filter(
    (p) =>
      p.id !== primaryProject &&
      (targetingProjects.includes(p.id) ||
        permissionsUtil.canTargetFeatureProjects([p.id])),
  );
  const canTargetAll =
    allProjects || permissionsUtil.canTargetFeatureProjects("all");
  const nothingToTarget = options.length === 0 && !canTargetAll;

  const help = `Also include this ${entityLabel} in these Projects' SDK payloads. Only Projects you have permission to target are listed.`;

  if (nothingToTarget && !enabled) return null;

  return (
    <Box {...marginProps}>
      {!enabled ? (
        <Box display="inline-block">
          <Link
            type="button"
            className="hover-underline"
            weight="medium"
            onClick={() => setEnabled(true)}
          >
            <PiPlusBold className="mr-1" />
            Targeting Projects
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
            <Box flexGrow="1" />
            <Link
              type="button"
              color="red"
              size="sm"
              mt="2"
              className="hover-underline"
              onClick={() => {
                setAllProjects(false);
                setTargetingProjects([]);
                setEnabled(false);
              }}
            >
              <PiX className="mr-1" />
              Remove targeting
            </Link>
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
                      options={options.map((p) => ({
                        value: p.id,
                        label: p.name,
                      }))}
                      placeholder="No Projects selected"
                      sort={false}
                      showCopyButton={false}
                      containerClassName="w-full"
                    />
                  </Box>
                ),
              },
              ...(canTargetAll
                ? [
                    {
                      value: "all",
                      label: "All Projects",
                      itemClassName: "mt-2",
                    },
                  ]
                : []),
            ]}
          />
        </>
      )}
    </Box>
  );
}
