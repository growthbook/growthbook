import { useMemo, useState } from "react";
import { ago } from "shared/dates";
import {
  experimentsReferencingSavedGroups,
  featuresReferencingSavedGroups,
  isProjectListValidForProject,
  truncateString,
} from "shared/util";
import Link from "next/link";
import { SavedGroupInterface } from "shared/src/types";
import { FaMagnifyingGlass } from "react-icons/fa6";
import { PiInfoFill } from "react-icons/pi";
import { isEmpty } from "lodash";
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { useSearch } from "@/services/search";
import { getSavedGroupMessage } from "@/pages/saved-groups";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/components/Radix/Button";
import Field from "@/components/Forms/Field";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import { useExperiments } from "@/hooks/useExperiments";
import SavedGroupForm from "./SavedGroupForm";

export interface Props {
  groups: SavedGroupInterface[];
  mutate: () => void;
}

export default function IdLists({ groups, mutate }: Props) {
  const [
    savedGroupForm,
    setSavedGroupForm,
  ] = useState<null | Partial<SavedGroupInterface>>(null);
  const { project } = useDefinitions();

  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canViewSavedGroupModal(project);
  const canUpdate = (savedGroup: Pick<SavedGroupInterface, "projects">) =>
    permissionsUtil.canUpdateSavedGroup(savedGroup, savedGroup);
  const canDelete = (savedGroup: Pick<SavedGroupInterface, "projects">) =>
    permissionsUtil.canDeleteSavedGroup(savedGroup);
  const { apiCall } = useAuth();

  const idLists = useMemo(() => {
    return groups.filter((g) => g.type === "list");
  }, [groups]);

  const filteredIdLists = project
    ? idLists.filter((list) =>
        isProjectListValidForProject(list.projects, project)
      )
    : idLists;

  const { features } = useFeaturesList(false);
  const { experiments } = useExperiments();

  const environments = useEnvironments();

  const {
    hasLargeSavedGroupFeature,
    unsupportedConnections,
  } = useLargeSavedGroupSupport();
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);

  // Get a list of feature ids for every saved group
  const referencingFeaturesByGroup = useMemo(
    () =>
      featuresReferencingSavedGroups({
        savedGroups: filteredIdLists,
        features,
        environments,
      }),
    [filteredIdLists, environments, features]
  );
  const referencingExperimentsByGroup = useMemo(
    () =>
      experimentsReferencingSavedGroups({
        savedGroups: filteredIdLists,
        experiments,
      }),
    [filteredIdLists, experiments]
  );

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: filteredIdLists,
    localStorageKey: "savedGroups",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["groupName^3", "attributeKey^2", "owner", "description^2"],
  });

  if (!idLists) return <LoadingOverlay />;

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason=""
          source="large-saved-groups"
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
        <div className="row align-items-center mb-1">
          <div className="col-auto">
            <h2 className="mb-0">ID Lists</h2>
          </div>
          <div className="flex-1"></div>
          {canCreate ? (
            <div className="col-auto">
              <Button
                onClick={async () => {
                  setSavedGroupForm({});
                }}
              >
                Add ID List
              </Button>
            </div>
          ) : null}
        </div>
        <p className="text-gray mb-1">
          Specify a list of values to include for an attribute.
        </p>
        <p className="text-gray mb-1">
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
        ) : (
          <p>
            <PiInfoFill /> Too many large lists will cause too large of a
            payload, and your server may not support it.
          </p>
        )}

        {filteredIdLists.length > 0 && (
          <>
            <div className="row mb-4 align-items-center">
              <div className="col-auto">
                <Field
                  prepend={<FaMagnifyingGlass />}
                  placeholder="Search..."
                  type="search"
                  {...searchInputProps}
                />
              </div>
            </div>
            <div className="row mb-0">
              <div className="col-12">
                <table className="table gbtable">
                  <thead>
                    <tr>
                      <SortableTH field={"groupName"}>Name</SortableTH>
                      <SortableTH field="attributeKey">Attribute</SortableTH>
                      <th>Description</th>
                      <th className="col-2">Projects</th>
                      <SortableTH field={"owner"}>Owner</SortableTH>
                      <SortableTH field={"dateUpdated"}>
                        Date Updated
                      </SortableTH>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((s) => {
                      return (
                        <tr key={s.id}>
                          <td>
                            <Link
                              className="text-color-primary"
                              key={s.id}
                              href={`/saved-groups/${s.id}`}
                            >
                              {s.groupName}
                            </Link>
                          </td>
                          <td>{s.attributeKey}</td>
                          <td>
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
                                    referencingExperimentsByGroup[s.id]
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
    </>
  );
}
