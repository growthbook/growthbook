import { useMemo, useState } from "react";
import { ago } from "shared/dates";
import { isProjectListValidForProject, truncateString } from "shared/util";
import Link from "next/link";
import {
  SavedGroupInterface,
  SavedGroupWithoutValues,
} from "shared/types/saved-group";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useAddComputedFields, useSearch } from "@/services/search";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";
import UpgradeModal from "@/components/Settings/UpgradeModal";
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
import SavedGroupForm from "./SavedGroupForm";
import SavedGroupDeleteModal from "./SavedGroupDeleteModal";
import SavedGroupRowMenu from "./SavedGroupRowMenu";

export interface Props {
  groups: SavedGroupWithoutValues[];
  mutate: () => void;
}

export default function IdLists({ groups, mutate }: Props) {
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

  const idLists = useMemo(() => {
    return groups.filter((g) => g.type === "list");
  }, [groups]);

  const filteredIdLists = project
    ? idLists.filter((list) =>
        isProjectListValidForProject(list.projects, project),
      )
    : idLists;

  const { hasLargeSavedGroupFeature, unsupportedConnections } =
    useLargeSavedGroupSupport();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);

  const idListsWithOwners = useAddComputedFields(
    filteredIdLists,
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
    items: idListsWithOwners,
    localStorageKey: "savedGroups",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: [
      "groupName^3",
      "attributeKey^2",
      "ownerNameDisplay",
      "description^2",
    ],
    pageSize: 50,
    updateSearchQueryOnChange: true,
  });

  if (!idLists) return <LoadingOverlay />;

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="large-saved-groups"
          commercialFeature="large-saved-groups"
        />
      )}
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
            type="list"
          />
        )}
        <Flex align="center" justify="between" mb="1">
          <Heading as="h2" size="x-large">
            ID Lists
          </Heading>
          {canCreate ? (
            <Button onClick={() => setSavedGroupForm({})}>Add ID List</Button>
          ) : null}
        </Flex>
        <Box mb="1" style={{ color: "var(--gray-11)" }}>
          <p style={{ margin: 0 }}>
            Specify a list of values to include for an attribute.
          </p>
        </Box>
        <Box style={{ color: "var(--gray-11)" }}>
          <p style={{ margin: 0 }}>
            For example, create a &quot;Beta Testers&quot; group identified by a
            specific set of <code>device_id</code> values.
          </p>
        </Box>

        {unsupportedConnections.length > 0 ? (
          <Box mt="4">
            <LargeSavedGroupPerformanceWarning
              hasLargeSavedGroupFeature={hasLargeSavedGroupFeature}
              unsupportedConnections={unsupportedConnections}
              openUpgradeModal={() => setUpgradeModal(true)}
            />
          </Box>
        ) : null}

        {filteredIdLists.length > 0 && (
          <>
            <Box className="relative" width="40%" mb="4">
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </Box>
            <Table variant="list" stickyHeader={false} roundedCorners>
              <TableHeader>
                <TableRow>
                  <SortableTableColumnHeader field="groupName">
                    Name
                  </SortableTableColumnHeader>
                  <SortableTableColumnHeader field="attributeKey">
                    Attribute
                  </SortableTableColumnHeader>
                  <TableColumnHeader>Description</TableColumnHeader>
                  <TableColumnHeader>Projects</TableColumnHeader>
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
                      <TableCell style={{ verticalAlign: "top" }}>
                        <Link
                          className="link-purple"
                          href={`/saved-groups/${s.id}`}
                        >
                          {s.groupName}
                        </Link>
                      </TableCell>
                      <TableCell style={{ verticalAlign: "top" }}>
                        {s.attributeKey}
                      </TableCell>
                      <TableCell style={{ verticalAlign: "top" }}>
                        {truncateString(s.description || "", 40)}
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
          </>
        )}
      </Box>
    </>
  );
}
