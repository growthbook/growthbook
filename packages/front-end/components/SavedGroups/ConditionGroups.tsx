import { useMemo, useState } from "react";
import Link from "next/link";
import { ago } from "shared/dates";
import {
  SavedGroupInterface,
  SavedGroupWithoutValues,
} from "shared/types/saved-group";
import { isProjectListValidForProject, truncateString } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useAddComputedFields, useSearch } from "@/services/search";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import ProjectBadges from "@/components/ProjectBadges";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import TruncatedConditionDisplay from "./TruncatedConditionDisplay";
import SavedGroupForm from "./SavedGroupForm";
import SavedGroupDeleteModal from "./SavedGroupDeleteModal";
import SavedGroupRowMenu from "./SavedGroupRowMenu";

export interface Props {
  groups: SavedGroupWithoutValues[];
  mutate: () => void;
}

export default function ConditionGroups({ groups, mutate }: Props) {
  const [savedGroupForm, setSavedGroupForm] =
    useState<null | Partial<SavedGroupInterface>>(null);
  const [deleteModal, setDeleteModal] =
    useState<SavedGroupWithoutValues | null>(null);
  const { project, projects } = useDefinitions();
  const { getOwnerDisplay } = useUser();

  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canViewSavedGroupModal(project, projects);
  const canUpdate = (savedGroup: Pick<SavedGroupInterface, "projects">) =>
    permissionsUtil.canUpdateSavedGroup(savedGroup, savedGroup);
  const canDeleteSavedGroup = (
    savedGroup: Pick<SavedGroupInterface, "projects">,
  ) => permissionsUtil.canDeleteSavedGroup(savedGroup);
  const { apiCall } = useAuth();

  const conditionGroups = useMemo(() => {
    return groups.filter((g) => g.type === "condition");
  }, [groups]);

  const filteredConditionGroups = project
    ? conditionGroups.filter((group) =>
        isProjectListValidForProject(group.projects, project),
      )
    : conditionGroups;

  const conditionGroupsWithOwners = useAddComputedFields(
    filteredConditionGroups,
    (group) => ({
      ownerNameDisplay: getOwnerDisplay(group.owner),
    }),
    [getOwnerDisplay],
  );

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    pagination,
  } = useSearch({
    items: conditionGroupsWithOwners,
    localStorageKey: "savedGroupsRuntime",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["groupName^3", "condition^2", "ownerNameDisplay"],
    pageSize: 50,
    updateSearchQueryOnChange: true,
  });

  if (!conditionGroups) return <LoadingOverlay />;

  return (
    <>
      {deleteModal && (
        <SavedGroupDeleteModal
          savedGroup={deleteModal}
          close={() => setDeleteModal(null)}
          onDelete={async () => {
            await apiCall(`/saved-groups/${deleteModal.id}`, {
              method: "DELETE",
            });
            mutate();
          }}
        />
      )}
      <Box mt="4" mb="5" p="4" className="appbox">
        {savedGroupForm && (
          <SavedGroupForm
            close={() => setSavedGroupForm(null)}
            current={savedGroupForm}
            type="condition"
          />
        )}
        <Flex align="center" justify="between" mb="1">
          <Heading as="h2" size="x-large">
            Condition Groups
          </Heading>
          {canCreate ? (
            <Button onClick={() => setSavedGroupForm({})}>
              Add Condition Group
            </Button>
          ) : null}
        </Flex>
        <Box mb="1" style={{ color: "var(--gray-11)" }}>
          <p style={{ margin: 0 }}>
            Set up advanced targeting rules based on user attributes.
          </p>
        </Box>
        <Box style={{ color: "var(--gray-11)" }}>
          <p style={{ margin: 0 }}>
            For example, target users located in the US <b>and</b> on a mobile
            device.
          </p>
        </Box>
        {filteredConditionGroups.length > 0 && (
          <>
            <Box className="relative" width="40%" mb="4">
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </Box>
            <Box>
              <Table variant="list" stickyHeader={false} roundedCorners>
                <TableHeader>
                  <TableRow>
                    <SortableTableColumnHeader
                      field="groupName"
                      style={{ maxWidth: 200 }}
                    >
                      Name
                    </SortableTableColumnHeader>
                    <SortableTableColumnHeader field="condition">
                      Condition
                    </SortableTableColumnHeader>
                    <TableColumnHeader>Description</TableColumnHeader>
                    <TableColumnHeader style={{ width: "16%" }}>
                      Projects
                    </TableColumnHeader>
                    <SortableTableColumnHeader field="ownerNameDisplay">
                      Owner
                    </SortableTableColumnHeader>
                    <SortableTableColumnHeader field="dateUpdated">
                      Date Updated
                    </SortableTableColumnHeader>
                    <TableColumnHeader style={{ width: 30 }} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((s) => {
                    return (
                      <TableRow key={s.id}>
                        <TableCell
                          style={{
                            width: "250px",
                            verticalAlign: "top",
                          }}
                        >
                          <Link
                            href={`/saved-groups/${s.id}`}
                            className="link-purple"
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: "vertical",
                              textOverflow: "ellipsis",
                              overflow: "hidden",
                              lineHeight: "1.2em",
                              wordBreak: "break-word",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {s.groupName}
                          </Link>
                        </TableCell>
                        <TableCell style={{ width: 400, verticalAlign: "top" }}>
                          <TruncatedConditionDisplay
                            condition={s.condition || ""}
                            savedGroups={[]}
                          />
                        </TableCell>
                        <TableCell
                          style={{ minWidth: 200, verticalAlign: "top" }}
                        >
                          <Flex wrap="wrap">
                            {truncateString(s.description || "", 40)}
                          </Flex>
                        </TableCell>
                        <TableCell style={{ verticalAlign: "top" }}>
                          {(s?.projects?.length || 0) > 0 ? (
                            <ProjectBadges
                              resourceType="saved group"
                              projectIds={s.projects}
                            />
                          ) : (
                            <ProjectBadges resourceType="saved group" />
                          )}
                        </TableCell>
                        <TableCell style={{ verticalAlign: "top" }}>
                          {s.ownerNameDisplay}
                        </TableCell>
                        <TableCell style={{ verticalAlign: "top" }}>
                          {ago(s.dateUpdated)}
                        </TableCell>
                        <TableCell style={{ width: 30, verticalAlign: "top" }}>
                          <SavedGroupRowMenu
                            canUpdate={canUpdate(s)}
                            canDelete={canDeleteSavedGroup(s)}
                            onEdit={() => setSavedGroupForm(s)}
                            onDelete={() => setDeleteModal(s)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!items.length && isFiltered && (
                    <TableRow>
                      <TableCell colSpan={7} style={{ textAlign: "center" }}>
                        No matching saved groups
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {pagination}
            </Box>
          </>
        )}
      </Box>
    </>
  );
}
