import { useEffect, useMemo, useState } from "react";
import { date, datetime } from "shared/dates";
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
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
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
import Link from "@/ui/Link";
import TruncatedConditionDisplay from "./TruncatedConditionDisplay";
import SavedGroupForm from "./SavedGroupForm";
import SavedGroupDeleteModal from "./SavedGroupDeleteModal";

export interface Props {
  groups: SavedGroupWithoutValues[];
  mutate: () => void;
}

export default function ConditionGroups({ groups, mutate }: Props) {
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

  const conditionGroups = useMemo(() => {
    return groups.filter((g) => g.type === "condition");
  }, [groups]);

  const filteredConditionGroups = useMemo(
    () =>
      project
        ? conditionGroups.filter((group) =>
            isProjectListValidForProject(group.projects, project),
          )
        : conditionGroups,
    [conditionGroups, project],
  );

  const [showArchived, setShowArchived] = useState(false);

  const conditionGroupsWithOwners = useAddComputedFields(
    filteredConditionGroups,
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

  const hasArchived = conditionGroups.some((g) => g.archived);
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
    items: conditionGroupsWithOwners,
    localStorageKey: "savedGroupsRuntime",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["groupName^3", "condition^2", "ownerNameDisplay"],
    pageSize: 50,
    updateSearchQueryOnChange: true,
    filterResults: !showArchived
      ? (items) => items.filter((g) => !g.archived)
      : undefined,
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
            approvalFlowRequired={approvalFlowRequired}
          />
        )}
        <Flex align="center" justify="between" mb="1">
          <h2 style={{ margin: 0 }}>Condition Groups</h2>
          {canCreate ? (
            <Button onClick={() => setSavedGroupForm({})}>
              Add Condition Group
            </Button>
          ) : null}
        </Flex>
        <p className="text-gray mb-1">
          Set up advanced targeting rules based on user attributes.
        </p>
        <p className="text-gray">
          For example, target users located in the US <b>and</b> on a mobile
          device.
        </p>
        {filteredConditionGroups.length > 0 && (
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
                groups={filteredConditionGroups}
                hasArchived={hasArchived}
                hasDraftStates={hasDraftStates}
              />
            </Flex>
            <Table variant="list" stickyHeader roundedCorners>
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
                      <TableCell style={{ width: 250 }}>
                        <Flex align="center" gap="2">
                          <Link
                            href={`/saved-groups/${s.id}`}
                            style={{
                              color: "var(--gray-12)",
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
                        </Flex>
                      </TableCell>
                      <TableCell style={{ width: 400 }}>
                        <TruncatedConditionDisplay
                          condition={s.condition || ""}
                          savedGroups={[]}
                        />
                      </TableCell>
                      <TableCell style={{ minWidth: 200 }}>
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
