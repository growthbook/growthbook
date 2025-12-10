import { useMemo, useState } from "react";
import { ago } from "shared/dates";
import { SavedGroupInterface } from "shared/types/groups";
import {
  experimentsReferencingSavedGroups,
  featuresReferencingSavedGroups,
  isProjectListValidForProject,
  truncateString,
} from "shared/util";
import { FaMagnifyingGlass } from "react-icons/fa6";
import { isEmpty } from "lodash";
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { useSearch } from "@/services/search";
import { getSavedGroupMessage } from "@/pages/saved-groups";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import { useExperiments } from "@/hooks/useExperiments";
import SavedGroupForm from "./SavedGroupForm";

export interface Props {
  groups: SavedGroupInterface[];
  mutate: () => void;
}

export default function ConditionGroups({ groups, mutate }: Props) {
  const [savedGroupForm, setSavedGroupForm] =
    useState<null | Partial<SavedGroupInterface>>(null);
  const { project } = useDefinitions();

  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canViewSavedGroupModal(project);
  const canUpdate = (savedGroup: Pick<SavedGroupInterface, "projects">) =>
    permissionsUtil.canUpdateSavedGroup(savedGroup, savedGroup);
  const canDelete = (savedGroup: Pick<SavedGroupInterface, "projects">) =>
    permissionsUtil.canDeleteSavedGroup(savedGroup);
  const { apiCall } = useAuth();

  const environments = useEnvironments();

  const conditionGroups = useMemo(() => {
    return groups.filter((g) => g.type === "condition");
  }, [groups]);

  const filteredConditionGroups = project
    ? conditionGroups.filter((group) =>
        isProjectListValidForProject(group.projects, project),
      )
    : conditionGroups;

  const { features } = useFeaturesList(false);
  const { experiments } = useExperiments();

  // Get a list of feature ids for every saved group
  const referencingFeaturesByGroup = useMemo(
    () =>
      featuresReferencingSavedGroups({
        savedGroups: filteredConditionGroups,
        features,
        environments,
      }),
    [filteredConditionGroups, environments, features],
  );

  const referencingExperimentsByGroup = useMemo(
    () =>
      experimentsReferencingSavedGroups({
        savedGroups: filteredConditionGroups,
        experiments,
      }),
    [filteredConditionGroups, experiments],
  );

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: filteredConditionGroups,
    localStorageKey: "savedGroupsRuntime",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["groupName^3", "condition^2", "owner"],
  });

  if (!conditionGroups) return <LoadingOverlay />;

  return (
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
            <Button
              onClick={async () => {
                setSavedGroupForm({});
              }}
            >
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
          <div className="row mb-4 align-items-center">
            <div className="col-auto">
              <Field
                inputGroupClassName="bg-white"
                prepend={<FaMagnifyingGlass />}
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-12">
              <table className="table gbtable appbox">
                <thead>
                  <tr>
                    <SortableTH field="groupName">Name</SortableTH>
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
                        <td>{s.groupName}</td>
                        <td>
                          <ConditionDisplay
                            condition={s.condition || ""}
                            savedGroups={[]}
                          />
                        </td>
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
                          <MoreMenu>
                            {canUpdate(s) ? (
                              <a
                                href="#"
                                className="dropdown-item"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setSavedGroupForm(s);
                                }}
                              >
                                Edit
                              </a>
                            ) : null}
                            {canDelete(s) ? (
                              <DeleteButton
                                displayName="Saved Group"
                                className="dropdown-item text-danger"
                                useIcon={false}
                                text="Delete"
                                title="Delete SavedGroup"
                                onClick={async () => {
                                  await apiCall(`/saved-groups/${s.id}`, {
                                    method: "DELETE",
                                  });
                                  mutate();
                                }}
                                getConfirmationContent={getSavedGroupMessage(
                                  referencingFeaturesByGroup[s.id],
                                  referencingExperimentsByGroup[s.id],
                                )}
                                canDelete={
                                  isEmpty(referencingFeaturesByGroup[s.id]) &&
                                  isEmpty(referencingExperimentsByGroup[s.id])
                                }
                              />
                            ) : null}
                          </MoreMenu>
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
            </div>
          </div>
        </>
      )}
    </Box>
  );
}
