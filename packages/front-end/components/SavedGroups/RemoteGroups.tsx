import { useEffect, useMemo, useState } from "react";
import { date, datetime } from "shared/dates";
import { isProjectListValidForProject, truncateString } from "shared/util";
import {
  SavedGroupInterface,
  SavedGroupWithoutValues,
} from "shared/types/saved-group";
import { Box, Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useAddComputedFields, useSearch } from "@/services/search";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import RemoteSavedGroupSetupCallout from "@/components/SavedGroups/RemoteSavedGroupSetupCallout";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import ProjectBadges from "@/components/ProjectBadges";
import Tooltip from "@/ui/Tooltip";
import Link from "@/ui/Link";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { useSavedGroupDraftStates } from "@/hooks/useSavedGroupDraftStates";
import SavedGroupSearchFilters from "@/components/Search/SavedGroupSearchFilters";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import SavedGroupForm from "./SavedGroupForm";
import SavedGroupDeleteModal from "./SavedGroupDeleteModal";

export interface Props {
  groups: SavedGroupWithoutValues[];
  mutate: () => void | Promise<void>;
}

/** The Remote Groups tab: groups whose IDs live outside the SDK payload. */
export default function RemoteGroups({ groups, mutate }: Props) {
  const [savedGroupForm, setSavedGroupForm] =
    useState<null | Partial<SavedGroupInterface>>(null);
  const [deleteModal, setDeleteModal] =
    useState<SavedGroupWithoutValues | null>(null);
  const { project, projects, getProjectById } = useDefinitions();
  const { getOwnerDisplay, hasCommercialFeature } = useUser();
  const hasFeature = hasCommercialFeature("large-saved-groups");
  const [upgradeModal, setUpgradeModal] = useState(false);

  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canViewSavedGroupModal(project, projects);
  const { apiCall } = useAuth();

  const draftHook = useSavedGroupDraftStates();

  const remoteGroups = useMemo(() => {
    return groups.filter((g) => g.type === "remote");
  }, [groups]);

  const filteredRemoteGroups = useMemo(
    () =>
      project
        ? remoteGroups.filter((list) =>
            isProjectListValidForProject(list.projects, project),
          )
        : remoteGroups,
    [remoteGroups, project],
  );

  const [showArchived, setShowArchived] = useState(false);

  const remoteGroupsWithOwners = useAddComputedFields(
    filteredRemoteGroups,
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

  const hasArchived = remoteGroups.some((g) => g.archived);

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    pagination,
    syntaxFilters,
    setSearchValue,
  } = useSearch({
    items: remoteGroupsWithOwners,
    localStorageKey: "savedGroupsRemote",
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
    if (hasDraftFilter) draftHook.fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDraftFilter]);

  if (!remoteGroups) return <LoadingOverlay />;

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
            type="remote"
            mutate={mutate}
          />
        )}
        {upgradeModal && (
          <UpgradeModal
            close={() => setUpgradeModal(false)}
            source="remote-saved-groups"
            commercialFeature="large-saved-groups"
          />
        )}
        <Flex align="center" justify="between" mb="1">
          <Flex align="center" gap="2">
            <Heading as="h2" size="lg" mb="0">
              Remote Groups
            </Heading>
            <PaidFeatureBadge commercialFeature="large-saved-groups" />
          </Flex>
          <Tooltip
            content="You do not have permission to create Saved Groups."
            enabled={!canCreate}
          >
            {/* A disabled button gets no hover events, so the tooltip wraps a span */}
            <span>
              <Button
                disabled={!canCreate}
                onClick={() =>
                  hasFeature ? setSavedGroupForm({}) : setUpgradeModal(true)
                }
              >
                Add Remote Group
              </Button>
            </span>
          </Tooltip>
        </Flex>
        <Text as="p" color="text-mid" mb="1">
          Remote Groups allow you to upload much larger lists of targeting IDs.
          The lists are stored and managed outside of the SDK payload.
        </Text>

        <Box mt="4">
          <RemoteSavedGroupSetupCallout />
        </Box>

        {filteredRemoteGroups.length > 0 && (
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
                groups={filteredRemoteGroups}
                hasArchived={hasArchived}
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
                  <SortableTableColumnHeader field="dateUpdated">
                    Last Modified
                  </SortableTableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((s) => {
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Flex align="center" gap="2">
                          <Link color="dark" href={`/saved-groups/${s.id}`}>
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
                      <TableCell title={datetime(s.dateUpdated)}>
                        {date(s.dateUpdated)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!items.length && isFiltered && (
                  <TableRow>
                    <TableCell colSpan={5} style={{ textAlign: "center" }}>
                      No matching Saved Groups
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
