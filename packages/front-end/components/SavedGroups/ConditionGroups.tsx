import { useMemo, useState } from "react";
import Link from "next/link";
import { ago } from "shared/dates";
import {
  SavedGroupInterface,
  SavedGroupWithoutValues,
} from "shared/types/saved-group";
import { isProjectListValidForProject, truncateString } from "shared/util";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, IconButton } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import TruncatedConditionDisplay from "./TruncatedConditionDisplay";
import SavedGroupForm from "./SavedGroupForm";
import SavedGroupDeleteModal from "./SavedGroupDeleteModal";

export interface Props {
  groups: SavedGroupWithoutValues[];
  mutate: () => void;
}

// Row menu component with controlled dropdown state
function SavedGroupRowMenu({
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
}: {
  savedGroup: SavedGroupWithoutValues;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
        >
          <BsThreeDotsVertical />
        </IconButton>
      }
      open={open}
      onOpenChange={setOpen}
      menuPlacement="end"
      variant="soft"
    >
      <DropdownMenuGroup>
        {canUpdate && (
          <DropdownMenuItem
            onClick={() => {
              onEdit();
              setOpen(false);
            }}
          >
            Edit
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem
            color="red"
            onClick={() => {
              onDelete();
              setOpen(false);
            }}
          >
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
    </DropdownMenu>
  );
}

export default function ConditionGroups({ groups, mutate }: Props) {
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

  const conditionGroups = useMemo(() => {
    return groups.filter((g) => g.type === "condition");
  }, [groups]);

  const filteredConditionGroups = project
    ? conditionGroups.filter((group) =>
        isProjectListValidForProject(group.projects, project),
      )
    : conditionGroups;

  const { items, searchInputProps, isFiltered, SortableTH, pagination } =
    useSearch({
      items: filteredConditionGroups,
      localStorageKey: "savedGroupsRuntime",
      defaultSortField: "dateCreated",
      defaultSortDir: -1,
      searchFields: ["groupName^3", "condition^2", "owner"],
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
        <div className="row align-items-center mb-1">
          <div className="col-auto">
            <h2 className="mb-0">Condition Groups</h2>
          </div>
          <div className="flex-1"></div>
          {canCreate ? (
            <div className="col-auto">
              <Button onClick={() => setSavedGroupForm({})}>
                Add Condition Group
              </Button>
            </div>
          ) : null}
        </div>
        <p className="text-gray mb-1">
          Set up advanced targeting rules based on user attributes.
        </p>
        <p className="text-gray">
          For example, target users located in the US <b>and</b> on a mobile
          device.
        </p>
        {filteredConditionGroups.length > 0 && (
          <>
            <Box className="relative" width="40%" mb="4">
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </Box>
            <div className="row mb-0">
              <div className="col-12">
                <table className="table gbtable">
                  <thead>
                    <tr>
                      <SortableTH field="groupName" style={{ maxWidth: 200 }}>
                        Name
                      </SortableTH>
                      <SortableTH field="condition">Condition</SortableTH>
                      <th>Description</th>
                      <th className="col-2">Projects</th>
                      <SortableTH field="owner">Owner</SortableTH>
                      <SortableTH field="dateUpdated">Date Updated</SortableTH>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((s) => {
                      return (
                        <tr key={s.id}>
                          <td style={{ width: "250px" }}>
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
                          </td>
                          <td style={{ width: 400 }}>
                            <TruncatedConditionDisplay
                              condition={s.condition || ""}
                              savedGroups={[]}
                            />
                          </td>
                          <td style={{ minWidth: 200 }}>
                            <div className="d-flex flex-wrap">
                              {truncateString(s.description || "", 40)}
                            </div>
                          </td>
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
                              savedGroup={s}
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
              </div>
            </div>
          </>
        )}
      </Box>
    </>
  );
}
