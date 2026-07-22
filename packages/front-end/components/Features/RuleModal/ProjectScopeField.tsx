import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiInfo, PiPlus } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import RadioGroup from "@/ui/RadioGroup";
import Link from "@/ui/Link";
import MultiSelectField from "@/ui/MultiSelectField";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";

// Rule-level project scope editor. Sits under the environment scope widget in
// every rule-type modal, opt-in like the feature-level targeting widget: a rule
// applies to all of the feature's projects by default, collapsed to a "+ Project
// scope" link until opted in (or seeded open when already scoped). "Specific
// projects" reveals a multiselect; an empty selection scopes the rule to no
// project (never "all") — matching the leak-safe backend encoding.
export type ProjectScopeProps = {
  allProjects: boolean;
  setAllProjects: (v: boolean) => void;
  selectedProjects: string[];
  setSelectedProjects: (v: string[]) => void;
  // The feature's delivery set (primary + targeting projects). `null` means the
  // feature delivers to all projects, so every project is selectable. Scoping is
  // limited to this set, but already-selected ids outside it are kept so a stale
  // selection isn't silently orphaned — the payload scrubs it at generation.
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
        <Flex align="center" gap="1">
          <Link
            onClick={() => {
              setEnabled(true);
              setAllProjects(false);
            }}
          >
            <PiPlus /> Project scope
          </Link>
          <Tooltip body={help}>
            <PiInfo />
          </Tooltip>
        </Flex>
      ) : (
        <>
          <Flex align="center" gap="1" mb="1">
            <label className="mb-0">Rule projects</label>
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
                      value={selectedProjects}
                      onChange={setSelectedProjects}
                      options={selectableProjects.map((p) => ({
                        value: p.id,
                        label: p.name,
                      }))}
                      placeholder="Select projects..."
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
              { value: "all", label: "All projects", itemClassName: "mt-2" },
            ]}
          />
        </>
      )}
    </Box>
  );
}
