import React, { useMemo, useState } from "react";
import { datetime } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { ConstantWithoutValue } from "shared/types/constant";
import { isProjectListValidForProject } from "shared/util";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Link from "@/ui/Link";
import EmptyState from "@/components/EmptyState";
import ProjectBadges from "@/components/ProjectBadges";
import { useAddComputedFields, useSearch } from "@/services/search";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import ConstantModal from "@/components/Constants/ConstantModal";

const TYPE_LABEL: Record<ConstantWithoutValue["type"], string> = {
  string: "String",
  json: "JSON",
};

export default function ConstantsPage(): React.ReactElement {
  const { ready, project, projects, constants } = useDefinitions();
  const { getOwnerDisplay } = useUser();
  const permissionsUtil = usePermissionsUtil();

  // Create when null target, edit when a constant is selected.
  const [modalOpen, setModalOpen] = useState(false);
  const [editConstant, setEditConstant] = useState<ConstantWithoutValue | null>(
    null,
  );

  const visibleConstants = useMemo(
    () =>
      constants.filter((c) =>
        isProjectListValidForProject(c.projects || [], project),
      ),
    [constants, project],
  );

  const constantItems = useAddComputedFields(visibleConstants, (c) => ({
    ownerName: getOwnerDisplay(c.owner) || "",
    typeLabel: TYPE_LABEL[c.type],
    projectNames: (c.projects || []).map(
      (p) => projects.find((proj) => proj.id === p)?.name || p,
    ),
  }));

  const { items, searchInputProps, isFiltered, SortableTableColumnHeader } =
    useSearch({
      items: constantItems,
      searchFields: ["key", "name", "description", "ownerName"],
      localStorageKey: "constants-search",
      defaultSortField: "key",
      defaultSortDir: 1,
    });

  if (!ready) {
    return <LoadingOverlay />;
  }

  const canAdd = permissionsUtil.canCreateConstant({
    projects: project ? [project] : [],
  });
  const hasConstants = constants.length > 0;

  const addButton = (
    <Button disabled={!canAdd} onClick={() => setModalOpen(true)}>
      Add Constant
    </Button>
  );

  return (
    <>
      <Box className="contents container-fluid pagecontents" mb="3" mt="2">
        <Flex mb="3" mt="2" align="center" justify="between">
          <h1 style={{ margin: 0 }}>Constants</h1>
          {hasConstants && canAdd && addButton}
        </Flex>

        {!hasConstants ? (
          <EmptyState
            title="Reusable values for your configs"
            description="Define a value once and reference it from feature flags with {{ @const:key }} or @import. Change it in one place and every consumer updates."
            leftButton={
              <LinkButton
                href="https://docs.growthbook.io/features/constants"
                variant="outline"
                external={true}
              >
                View docs
              </LinkButton>
            }
            rightButton={canAdd ? addButton : null}
          />
        ) : (
          <>
            <Box mb="3" style={{ width: "40%" }}>
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </Box>
            <Table variant="list" stickyHeader roundedCorners>
              <TableHeader>
                <TableRow>
                  <SortableTableColumnHeader field="key">
                    Key
                  </SortableTableColumnHeader>
                  <SortableTableColumnHeader field="name">
                    Name
                  </SortableTableColumnHeader>
                  <SortableTableColumnHeader field="typeLabel">
                    Type
                  </SortableTableColumnHeader>
                  <TableColumnHeader>Projects</TableColumnHeader>
                  <SortableTableColumnHeader field="ownerName">
                    Owner
                  </SortableTableColumnHeader>
                  <SortableTableColumnHeader field="dateUpdated">
                    Last Modified
                  </SortableTableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow
                    key={c.id}
                    style={{
                      color: c.archived ? "var(--gray-11)" : undefined,
                    }}
                  >
                    <TableCell style={{ padding: "var(--space-0)" }}>
                      <Link
                        color="dark"
                        style={{ display: "block", padding: "var(--space-3)" }}
                        onClick={() => {
                          setEditConstant(c);
                          setModalOpen(true);
                        }}
                      >
                        {c.key}
                      </Link>
                    </TableCell>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{c.typeLabel}</TableCell>
                    <TableCell>
                      {c.projects && c.projects.length > 0 ? (
                        <ProjectBadges
                          resourceType="feature"
                          projectIds={c.projects}
                        />
                      ) : null}
                    </TableCell>
                    <TableCell>{c.ownerName}</TableCell>
                    <TableCell title={datetime(c.dateUpdated)}>
                      {datetime(c.dateUpdated)}
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} style={{ textAlign: "center" }}>
                      {isFiltered
                        ? "No constants match the current filter."
                        : "No constants found."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </>
        )}
      </Box>
      {modalOpen && (
        <ConstantModal
          existing={editConstant}
          close={() => {
            setModalOpen(false);
            setEditConstant(null);
          }}
        />
      )}
    </>
  );
}
