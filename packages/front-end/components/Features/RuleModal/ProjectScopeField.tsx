import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiInfo, PiPlusBold } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import RadioGroup from "@/ui/RadioGroup";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import MultiSelectField from "@/ui/MultiSelectField";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";

// Rule-level project scope editor, opt-in like the feature-level targeting widget.
// Empty "Specific projects" selection = no project, never "all" (leak-safe).
export type ProjectScopeProps = {
  allProjects: boolean;
  setAllProjects: (v: boolean) => void;
  selectedProjects: string[];
  setSelectedProjects: (v: string[]) => void;
  // Feature delivery set (primary + targeting); null = all projects selectable.
  // Selection limited to this set, but stale out-of-set ids are kept (payload scrubs them).
  allowedProjectIds?: string[] | null;
} & MarginProps;

export default function RuleProjectScopeField({
  allProjects,
  setAllProjects,
  selectedProjects,
  setSelectedProjects,
  allowedProjectIds,
  ...marginProps
}: ProjectScopeProps) {
  const { projects } = useDefinitions();
  const [enabled, setEnabled] = useState<boolean>(() => !allProjects);

  // Only useful when the feature reaches >1 project; hide unless a scope is already set.
  const hasMultipleProjects =
    allowedProjectIds == null || allowedProjectIds.length > 1;
  const hasExistingScope = !allProjects || selectedProjects.length > 0;
  if (!hasMultipleProjects && !hasExistingScope) return null;

  const selectableProjects =
    allowedProjectIds == null
      ? projects
      : projects.filter(
          (p) =>
            allowedProjectIds.includes(p.id) || selectedProjects.includes(p.id),
        );

  const help =
    "Limit this rule to specific projects. Applies to all of the feature's projects by default.";

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
            Project targeting
            <Tooltip body={<Text as="div">{help}</Text>}>
              <PiInfo color="var(--color-text-low)" className="ml-1" />
            </Tooltip>
          </Link>
        </Box>
      ) : (
        <>
          <Flex align="center" gap="1" mb="3">
            <label className="mb-0" style={{ fontWeight: 600 }}>
              Rule Projects
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
              { value: "all", label: "All Projects" },
              {
                value: "specific",
                label: "Specific Projects",
                renderOutsideItem: true,
                renderOnSelect: (
                  <Box pl="5">
                    <MultiSelectField
                      value={selectedProjects}
                      onChange={setSelectedProjects}
                      options={selectableProjects.map((p) => ({
                        value: p.id,
                        label: p.name,
                      }))}
                      placeholder="No projects selected"
                      sort={false}
                      containerClassName="w-full"
                    />
                    {selectedProjects.length === 0 && (
                      <Callout status="warning" size="sm" mt="2">
                        This rule will not apply in any project until at least
                        one is selected.
                      </Callout>
                    )}
                  </Box>
                ),
              },
            ]}
          />
        </>
      )}
    </Box>
  );
}
