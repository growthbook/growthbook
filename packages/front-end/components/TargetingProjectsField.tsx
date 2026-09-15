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

// Controlled targeting-projects editor, collapsed to a link until opted in.
// Projects the viewer may not target are disabled rather than omitted.
export type TargetingProjectsFieldProps = {
  // Governance project, excluded from the options.
  primaryProject?: string;
  allProjects: boolean;
  setAllProjects: (value: boolean) => void;
  targetingProjects: string[];
  setTargetingProjects: (value: string[]) => void;
  // Noun for the help tooltip (e.g. "feature", "config", "constant").
  entityLabel?: string;
  // What counts as already targeted. Defaults to the values at mount; a create
  // (or duplicate) form passes nothing-yet, since the server judges the whole
  // set as an addition.
  baseline?: { allProjects: boolean; targetingProjects: string[] };
} & MarginProps;

export default function TargetingProjectsField({
  primaryProject,
  allProjects,
  setAllProjects,
  targetingProjects,
  setTargetingProjects,
  entityLabel = "feature",
  baseline: baselineProp,
  ...marginProps
}: TargetingProjectsFieldProps) {
  const { projects } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const [enabled, setEnabled] = useState<boolean>(
    () => allProjects || targetingProjects.length > 0,
  );
  // What the editor opened with. Anything already targeted stays selectable
  // for the whole edit, so removing it can be undone without the permission
  // it would take to add it fresh.
  const [mountBaseline] = useState(() => ({
    allProjects,
    targetingProjects,
  }));
  const baseline = baselineProp ?? mountBaseline;

  const optedOut = projects.filter((p) => p.allowTargeting === false);
  const canTarget = (projectId: string) =>
    baseline.allProjects ||
    baseline.targetingProjects.includes(projectId) ||
    (permissionsUtil.canTargetFeatureProjects([projectId]) &&
      !optedOut.some((p) => p.id === projectId));
  const disabledReason = (projectId: string) =>
    optedOut.some((p) => p.id === projectId)
      ? "This Project doesn't allow targeting from other Projects' Feature Flags"
      : "You don't have permission to target this Project";
  // `projects` is already read-filtered, so a restricted Project the viewer
  // cannot see is never offered. One already selected still needs a chip so
  // it can be seen and removed.
  const options = [
    ...projects
      .filter((p) => p.id !== primaryProject)
      .map((p) => ({
        value: p.id,
        label: p.name,
        ...(canTarget(p.id) ? {} : { tooltip: disabledReason(p.id) }),
      })),
    ...Array.from(
      new Set([...baseline.targetingProjects, ...targetingProjects]),
    )
      .filter((id) => !projects.some((p) => p.id === id))
      .map((id) => ({
        value: id,
        label: "Hidden Project",
        tooltip: `A Project you don't have access to (${id})`,
      })),
  ];
  const canTargetAll =
    baseline.allProjects ||
    (permissionsUtil.canTargetFeatureProjects("all") && optedOut.length === 0);
  const allProjectsReason =
    optedOut.length > 0 && !baseline.allProjects
      ? `${optedOut.map((p) => p.name).join(", ")} ${
          optedOut.length === 1 ? "doesn't" : "don't"
        } allow targeting`
      : "Requires permission to target all Projects";

  const help = `Also include this ${entityLabel} in these Projects' SDK payloads`;

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
                      options={options}
                      // A selected value must stay enabled or react-select hides
                      // its remove control; it is disabled once removed.
                      isOptionDisabled={(o) =>
                        "value" in o &&
                        !canTarget(o.value) &&
                        !targetingProjects.includes(o.value)
                      }
                      placeholder="No Projects selected"
                      sort={false}
                      showCopyButton={false}
                      containerClassName="w-full"
                    />
                  </Box>
                ),
              },
              {
                value: "all",
                label: "All Projects",
                itemClassName: "mt-2",
                disabled: !canTargetAll,
                disabledReason: allProjectsReason,
              },
            ]}
          />
        </>
      )}
    </Box>
  );
}
