import { useMemo, useState } from "react";
import { ago } from "shared/dates";
import { SavedGroupInterface } from "shared/src/types";
import { truncateString } from "shared/util";
import { FaMagnifyingGlass } from "react-icons/fa6";
import { useAuth } from "@/services/auth";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { useSearch } from "@/services/search";
import { getSavedGroupMessage } from "@/pages/saved-groups";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/components/Button";
import { GBAddCircle } from "@/components/Icons";
import Field from "@/components/Forms/Field";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import SavedGroupForm from "./SavedGroupForm";

export interface Props {
  groups: SavedGroupInterface[];
  mutate: () => void;
}

export default function ConditionGroups({ groups, mutate }: Props) {
  const [
    savedGroupForm,
    setSavedGroupForm,
  ] = useState<null | Partial<SavedGroupInterface>>(null);
  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canCreateSavedGroup();
  const canUpdate = permissionsUtil.canUpdateSavedGroup();
  const canDelete = permissionsUtil.canDeleteSavedGroup();
  const { apiCall } = useAuth();

  const environments = useEnvironments();

  const conditionGroups = useMemo(() => {
    return groups.filter((g) => g.type === "condition");
  }, [groups]);

  const { features } = useFeaturesList(false);

  // Get a list of feature ids for every saved group
  // TODO: also get experiments
  const savedGroupFeatureIds = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    features.forEach((feature) => {
      environments.forEach((env) => {
        if (feature.environmentSettings[env.id]?.rules) {
          feature.environmentSettings[env.id].rules.forEach((rule) => {
            conditionGroups.forEach((group) => {
              if (
                rule.condition?.includes(group.id) ||
                rule.savedGroups?.some((g) => g.ids.includes(group.id))
              ) {
                map[group.id] = map[group.id] || new Set();
                map[group.id].add(feature.id);
              }
            });
          });
        }
      });
    });
    return map;
  }, [conditionGroups, features, environments]);

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: conditionGroups,
    localStorageKey: "savedGroupsRuntime",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["groupName^3", "condition^2", "owner"],
  });

  if (!conditionGroups) return <LoadingOverlay />;

  return (
    <div
      className="mb-5 p-3 bg-white appbox border-top-0"
      style={{ borderRadius: "0 0 5px 5px" }}
    >
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
              color="primary"
              onClick={async () => {
                setSavedGroupForm({});
              }}
            >
              <GBAddCircle /> Add Condition Group
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
      {conditionGroups.length > 0 && (
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
              <table className="table gbtable">
                <thead>
                  <tr>
                    <SortableTH field="groupName">Name</SortableTH>
                    <SortableTH field="condition">Condition</SortableTH>
                    <th>Description</th>
                    <SortableTH field="owner">Owner</SortableTH>
                    <SortableTH field="dateUpdated">Date Updated</SortableTH>
                    {(canUpdate || canDelete) && <th />}
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
                        <td>{s.owner}</td>
                        <td>{ago(s.dateUpdated)}</td>
                        {canUpdate || canDelete ? (
                          <td style={{ width: 30 }}>
                            <MoreMenu>
                              {canUpdate ? (
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
                              {canDelete ? (
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
                                    savedGroupFeatureIds[s.id]
                                  )}
                                  canDelete={
                                    (savedGroupFeatureIds[s.id]?.size || 0) ===
                                    0
                                  }
                                />
                              ) : null}
                            </MoreMenu>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                  {!items.length && isFiltered && (
                    <tr>
                      <td
                        colSpan={canUpdate || canDelete ? 6 : 5}
                        align={"center"}
                      >
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
    </div>
  );
}
