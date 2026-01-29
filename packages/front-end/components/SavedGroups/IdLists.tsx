import { useMemo, useState } from "react";
import { ago } from "shared/dates";
import { isProjectListValidForProject, truncateString } from "shared/util";
import Link from "next/link";
import {
  SavedGroupInterface,
  SavedGroupWithoutValues,
} from "shared/types/saved-group";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
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
  const { project } = useDefinitions();

  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canViewSavedGroupModal(project);
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

  const { items, searchInputProps, isFiltered, SortableTH, pagination } =
    useSearch({
      items: filteredIdLists,
      localStorageKey: "savedGroups",
      defaultSortField: "dateCreated",
      defaultSortDir: -1,
      searchFields: ["groupName^3", "attributeKey^2", "owner", "description^2"],
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
          <Heading size="6" mb="0">
            ID Lists
          </Heading>
          {canCreate ? (
            <Button onClick={() => setSavedGroupForm({})}>Add ID List</Button>
          ) : null}
        </Flex>
        <p className="text-gray mb-1">
          Specify a list of values to include for an attribute.
        </p>
        <p className="text-gray">
          For example, create a &quot;Beta Testers&quot; group identified by a
          specific set of <code>device_id</code> values.
        </p>

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
            <table className="table gbtable table-valign-top">
              <thead>
                <tr>
                  <SortableTH field={"groupName"}>Name</SortableTH>
                  <SortableTH field="attributeKey">Attribute</SortableTH>
                  <th>Description</th>
                  <th>Projects</th>
                  <SortableTH field={"owner"}>Owner</SortableTH>
                  <SortableTH field={"dateUpdated"}>Date Updated</SortableTH>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  return (
                    <tr key={s.id}>
                      <td>
                        <Link
                          className="link-purple"
                          key={s.id}
                          href={`/saved-groups/${s.id}`}
                        >
                          {s.groupName}
                        </Link>
                      </td>
                      <td>{s.attributeKey}</td>
                      <td>{truncateString(s.description || "", 40)}</td>
                      <td>
                        {(s?.projects?.length || 0) > 0 ? (
                          <ProjectBadges
                            resourceType="saved group"
                            projectIds={s.projects}
                          />
                        ) : (
                          <ProjectBadges resourceType="saved group" />
                        )}
                      </td>
                      <td>{s.owner}</td>
                      <td>{ago(s.dateUpdated)}</td>
                      <td style={{ width: 30 }}>
                        <SavedGroupRowMenu
                          canUpdate={canUpdate(s)}
                          canDelete={canDeleteSavedGroup(s)}
                          onEdit={() => setSavedGroupForm(s)}
                          onDelete={() => setDeleteModal(s)}
                        />
                      </td>
                    </tr>
                  );
                })}
                {!items.length && isFiltered && (
                  <tr>
                    <td colSpan={7} align={"center"}>
                      No matching saved groups
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {pagination}
          </>
        )}
      </Box>
    </>
  );
}
