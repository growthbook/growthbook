import { useEffect, useMemo, useState } from "react";
import { date, datetime } from "shared/dates";
import { isProjectListValidForProject, truncateString } from "shared/util";
import Link from "next/link";
import {
  SavedGroupInterface,
  SavedGroupWithoutValues,
} from "shared/types/saved-group";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useAddComputedFields, useSearch } from "@/services/search";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import ProjectBadges from "@/components/ProjectBadges";
import useOrgSettings from "@/hooks/useOrgSettings";
import Tooltip from "@/components/Tooltip/Tooltip";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import {
  draftStatusDots,
  draftStatusTooltip,
} from "@/components/Reviews/RevisionStatusBadge";
import { useSavedGroupDraftStates } from "@/hooks/useSavedGroupDraftStates";
import SavedGroupSearchFilters from "@/components/Search/SavedGroupSearchFilters";
import SavedGroupForm from "./SavedGroupForm";
import SavedGroupDeleteModal from "./SavedGroupDeleteModal";

export interface Props {
  groups: SavedGroupWithoutValues[];
  mutate: () => void;
}

export default function IdLists({ groups, mutate }: Props) {
  const [savedGroupForm, setSavedGroupForm] =
    useState<null | Partial<SavedGroupInterface>>(null);
  const [deleteModal, setDeleteModal] =
    useState<SavedGroupWithoutValues | null>(null);
  const settings = useOrgSettings();
  const approvalFlowRequired =
    settings.approvalFlows?.savedGroups?.[0]?.required ?? false;
  const { project, projects, getProjectById } = useDefinitions();
  const { getOwnerDisplay } = useUser();

  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canViewSavedGroupModal(project, projects);
  const { apiCall } = useAuth();

  const draftHook = useSavedGroupDraftStates();

  const idLists = useMemo(() => {
    return groups.filter((g) => g.type === "list");
  }, [groups]);

  const filteredIdLists = useMemo(
    () =>
      project
        ? idLists.filter((list) =>
            isProjectListValidForProject(list.projects, project),
          )
        : idLists,
    [idLists, project],
  );

  const { hasLargeSavedGroupFeature, unsupportedConnections, connections } =
    useLargeSavedGroupSupport();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useState(false);

  const idListsWithOwners = useAddComputedFields(
    filteredIdLists,
    (group) => {
      const projectNames = (group.projects ?? [])
        .map((id) => getProjectById(id)?.name ?? "")
        .filter(Boolean);
      return {
        ownerNameDisplay: getOwnerDisplay(group.owner),
        projectNames,
      };
    },
    [getOwnerDisplay, getProjectById],
  );

  const hasArchived = idLists.some((g) => g.archived);
  const hasDraftStates = Object.keys(draftHook.draftStates).length > 0;

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    pagination,
    syntaxFilters,
    setSearchValue,
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
    filterResults: !showArchived
      ? (items) => items.filter((g) => !g.archived)
      : undefined,
    // The `has:draft` filter reads async-loaded draft states; declare the dep so
    // results recompute when they arrive (even when `filterResults` is stable).
    searchTermFilterDeps: [draftHook.draftStates],
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [];
        if (item.archived) is.push("archived");
        return is;
      },
      has: (item) => {
        const has: string[] = [];
        if (draftHook.draftStates[item.id]) has.push("draft", "drafts");
        return has;
      },
      owner: (item) => item.ownerNameDisplay,
      project: (item) => [...(item.projects ?? []), ...item.projectNames],
    },
  });

  // Sync showArchived state from is:archived syntax filter
  useEffect(() => {
    setShowArchived(
      syntaxFilters.some(
        (f) => f.field === "is" && f.values.includes("archived"),
      ),
    );
  }, [syntaxFilters]);

  const hasDraftFilter = syntaxFilters.some(
    (f) => f.field === "has" && f.values.includes("draft"),
  );

  useEffect(() => {
    if (hasDraftFilter) {
      draftHook.fetchAll();
    } else {
      const ids = items.map((s) => s.id);
      if (ids.length) draftHook.fetchSome(ids);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hasDraftFilter]);

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
            approvalFlowRequired={approvalFlowRequired}
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
              connections={connections}
              openUpgradeModal={() => setUpgradeModal(true)}
            />
          </Box>
        ) : null}

        {filteredIdLists.length > 0 && (
          <>
            <Flex align="center" justify="between" gap="3" mb="4">
              <Box style={{ width: "40%" }}>
                <Field
                  placeholder="Search..."
                  type="search"
                  {...searchInputProps}
                />
              </Box>
              <SavedGroupSearchFilters
                searchInputProps={searchInputProps}
                syntaxFilters={syntaxFilters}
                setSearchValue={setSearchValue}
                groups={filteredIdLists}
                hasArchived={hasArchived}
                hasDraftStates={hasDraftStates}
              />
            </Flex>
            <Table variant="list" stickyHeader roundedCorners>
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
                  <TableColumnHeader style={{ textAlign: "center" }}>
                    Draft Status
                  </TableColumnHeader>
                  <SortableTableColumnHeader field="dateUpdated">
                    Last Modified
                  </SortableTableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((s) => {
                  const draftEntry = draftHook.draftStates[s.id];
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Flex align="center" gap="2">
                          <Link
                            style={{ color: "var(--gray-12)" }}
                            href={`/saved-groups/${s.id}`}
                          >
                            {s.groupName}
                          </Link>
                        </Flex>
                      </TableCell>
                      <TableCell>{s.attributeKey}</TableCell>
                      <TableCell>
                        {truncateString(s.description || "", 40)}
                      </TableCell>
                      <TableCell>
                        {(s?.projects?.length || 0) > 0 ? (
                          <ProjectBadges
                            resourceType="saved group"
                            projectIds={s.projects}
                          />
                        ) : (
                          <ProjectBadges resourceType="saved group" />
                        )}
                      </TableCell>
                      <TableCell>
                        {draftEntry
                          ? (() => {
                              const dots = draftStatusDots(draftEntry);
                              if (!dots.length) return null;
                              return (
                                <Tooltip
                                  flipTheme={false}
                                  body={draftStatusTooltip(draftEntry)}
                                  usePortal
                                >
                                  <Flex
                                    align="center"
                                    justify="center"
                                    gap="1"
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      padding: "0 4px",
                                    }}
                                  >
                                    {dots.map((bg) => (
                                      <span
                                        key={bg}
                                        style={{
                                          display: "block",
                                          width: 8,
                                          height: 8,
                                          borderRadius: "50%",
                                          flexShrink: 0,
                                          background: bg,
                                        }}
                                      />
                                    ))}
                                  </Flex>
                                </Tooltip>
                              );
                            })()
                          : null}
                      </TableCell>
                      <TableCell title={datetime(s.dateUpdated)}>
                        {date(s.dateUpdated)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!items.length && isFiltered && (
                  <TableRow>
                    <TableCell colSpan={6} style={{ textAlign: "center" }}>
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
