import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";

export type DataSourceProjectChoice = {
  id: string;
  name: string;
  canCreate: boolean;
};

const NO_PERMISSION =
  "You don't have permission to create a Data Source in this Project.";

export default function DataSourceProjectScope({
  limitToProjects,
  selectedIds,
  canCreateForAllProjects,
  projects,
  onChange,
}: {
  /** False means All Projects. An empty selection is not All Projects. */
  limitToProjects: boolean;
  selectedIds: string[];
  canCreateForAllProjects: boolean;
  projects: DataSourceProjectChoice[];
  onChange: (limitToProjects: boolean, selectedIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const creatableIds = projects
    .filter((project) => project.canCreate)
    .map((project) => project.id);
  // All Projects is stored as an empty list, so every Project this user can
  // assign shows as checked while that scope is selected.
  const checkedIds = limitToProjects ? selectedIds : creatableIds;

  if (projects.length === 0 && canCreateForAllProjects) {
    return (
      <Text as="p" size="sm" mb="3">
        Available in: <Text weight="semibold">All Projects</Text>
      </Text>
    );
  }

  if (projects.length === 0) {
    return (
      <Text as="p" size="sm" color="text-mid" mb="3">
        {"You don't have permission to create a Data Source."}
      </Text>
    );
  }

  const selectedNames = projects
    .filter((project) => checkedIds.includes(project.id))
    .map((project) => project.name);
  const applySelection = (ids: string[]) => {
    const next = creatableIds.filter((id) => ids.includes(id));
    // Every Project this user can assign, and they may use All Projects:
    // that scope also covers Projects created later, which a checked list
    // does not. Someone who can't assign All Projects keeps the explicit list.
    if (
      canCreateForAllProjects &&
      creatableIds.length > 0 &&
      next.length === creatableIds.length
    ) {
      onChange(false, []);
      return;
    }
    onChange(true, next);
  };
  const names = !limitToProjects
    ? ["All Projects"]
    : selectedNames.length > 0
      ? selectedNames.slice(0, 2)
      : [];
  const extra =
    limitToProjects && selectedNames.length > 2 ? selectedNames.length - 2 : 0;
  const empty = limitToProjects && selectedNames.length === 0;
  const summaryText = (
    <Text as="div" size="sm" truncate>
      Available in:{" "}
      {empty ? (
        <Text color="text-mid">Select a Project</Text>
      ) : (
        <Text weight="semibold">
          {names.join(", ")}
          {extra > 0 ? ` +${extra}` : ""}
        </Text>
      )}
    </Text>
  );

  const filtered = projects.filter((project) =>
    project.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Box position="relative" width="100%" mb="3">
      <Flex align="center" gap="2" width="100%" minWidth="0">
        <Box minWidth="0" style={{ flex: "0 1 auto" }}>
          {extra > 0 ? (
            <Tooltip
              content={
                // Tooltip content renders inside a <p>, so a <ul> would be
                // invalid nesting.
                <span role="list" style={{ display: "block" }}>
                  {selectedNames.map((name) => (
                    <span
                      key={name}
                      role="listitem"
                      style={{ display: "list-item", marginLeft: "1em" }}
                    >
                      {name}
                    </span>
                  ))}
                </span>
              }
              side="top"
              maxWidth="320px"
            >
              {/* Text drops the handlers a tooltip trigger needs. */}
              <Box>{summaryText}</Box>
            </Tooltip>
          ) : (
            summaryText
          )}
        </Box>
        <Flex align="center" gap="2" flexShrink="0">
          <Text size="sm" color="text-low">
            ·
          </Text>
          <Popover
            // The summary text changes width as Projects are checked. Anchor
            // to this row, which does not, so the popover stays put.
            anchor={
              <Box
                position="absolute"
                inset="0"
                style={{ pointerEvents: "none" }}
              />
            }
            trigger={<Link>Edit</Link>}
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) setQuery("");
            }}
            side="bottom"
            align="start"
            sideOffset={8}
            showArrow={false}
            contentStyle={{ width: 320 }}
            content={
              <Box>
                <Text as="p" weight="semibold" mb="1">
                  Assign to Projects
                </Text>
                <Text as="p" size="sm" color="text-mid" mb="3">
                  {canCreateForAllProjects
                    ? "Check every Project to assign this Data Source to All Projects, including Projects created later."
                    : "All Projects isn't available for your role. This Data Source is limited to the Projects you check."}
                </Text>
                <Flex align="center" gap="2" mb="3">
                  <Link onClick={() => applySelection(creatableIds)}>
                    Check all
                  </Link>
                  <Text size="sm" color="text-low">
                    ·
                  </Text>
                  <Link onClick={() => applySelection([])}>Check none</Link>
                </Flex>
                <Box pt="3" style={{ borderTop: "1px solid var(--gray-a6)" }}>
                  {projects.length > 10 ? (
                    <TextField
                      type="search"
                      size="sm"
                      placeholder="Search Projects"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      mb="3"
                    />
                  ) : null}
                  {filtered.length === 0 ? (
                    <Text as="p" size="sm" color="text-mid" mb="0">
                      No matching Projects.
                    </Text>
                  ) : (
                    <Flex
                      direction="column"
                      gap="2"
                      style={{ maxHeight: 240, overflowY: "auto" }}
                    >
                      {filtered.map((project) => (
                        <ProjectOption
                          key={project.id}
                          project={project}
                          checked={checkedIds.includes(project.id)}
                          onToggle={(id, checked) => {
                            applySelection(
                              checked
                                ? [...checkedIds, id]
                                : checkedIds.filter(
                                    (selected) => selected !== id,
                                  ),
                            );
                          }}
                        />
                      ))}
                    </Flex>
                  )}
                </Box>
              </Box>
            }
          />
        </Flex>
      </Flex>
    </Box>
  );
}

function ProjectOption({
  project,
  checked,
  onToggle,
}: {
  project: DataSourceProjectChoice;
  checked: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const row = (
    <Flex align="center" justify="between" gap="3" width="100%">
      <Box flexGrow="1" minWidth="0">
        <Checkbox
          value={checked}
          disabled={!project.canCreate}
          setValue={(on) => onToggle(project.id, on)}
          label={project.name}
          weight="regular"
          labelSize="sm"
          align="center"
          size="sm"
        />
      </Box>
      {!project.canCreate ? (
        <Flex flexShrink="0">
          <Text size="sm" color="text-low">
            No permission
          </Text>
        </Flex>
      ) : null}
    </Flex>
  );

  if (project.canCreate) return row;
  return (
    <Tooltip content={NO_PERMISSION} side="left" maxWidth="240px">
      <Box width="100%">{row}</Box>
    </Tooltip>
  );
}
