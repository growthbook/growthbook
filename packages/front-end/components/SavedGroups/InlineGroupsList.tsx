import { SavedGroupInterface } from "back-end/types/saved-group";
import { useState } from "react";
import { ago } from "shared/dates";
import { isLegacySavedGroup } from "shared/util";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
import { useAddComputedFields, useSearch } from "@/services/search";
import { SavedGroupUsageMap, getSavedGroupMessage } from "@/pages/saved-groups";
import LoadingOverlay from "../LoadingOverlay";
import Button from "../Button";
import { GBAddCircle } from "../Icons";
import Field from "../Forms/Field";
import MoreMenu from "../Dropdown/MoreMenu";
import DeleteButton from "../DeleteButton/DeleteButton";
import ConditionDisplay from "../Features/ConditionDisplay";
import Tooltip from "../Tooltip/Tooltip";
import SavedGroupForm from "./SavedGroupForm";

export interface Props {
  groups: SavedGroupInterface[];
  mutate: () => void;
  usage: SavedGroupUsageMap;
}

export default function InlineGroupsList({ groups, mutate, usage }: Props) {
  const [
    savedGroupForm,
    setSavedGroupForm,
  ] = useState<null | Partial<SavedGroupInterface>>(null);
  const permissions = usePermissions();
  const { apiCall } = useAuth();

  const groupsWithUsage = useAddComputedFields(groups, (item) => {
    const all = usage.get(item.id)?.all || [];
    const features = all.filter((u) => u.type === "feature").length;
    const experiments = all.filter((u) => u.type === "experiment").length;
    return {
      usageCount: all.length,
      features,
      experiments,
      usage: all,
    };
  });

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: groupsWithUsage,
    localStorageKey: "savedGroups",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["groupName^3", "owner", "condition"],
  });

  if (!groups) return <LoadingOverlay />;

  const hasMigratedGroups = groups.some((g) => {
    // Inline groups
    if (isLegacySavedGroup(g.condition, g.attributeKey || "")) return true;
    // Runtime groups
    if (g.attributeKey && g.condition.includes("$groups")) return true;
    return false;
  });

  return (
    <div className="mb-5">
      {savedGroupForm && (
        <SavedGroupForm
          close={() => setSavedGroupForm(null)}
          current={savedGroupForm}
          legacyTargetingUsage={
            usage.get(savedGroupForm.id || "")?.legacy || []
          }
        />
      )}
      {hasMigratedGroups && (
        <div className="alert alert-info">
          <strong>Heads up!</strong> We&apos;ve migrated all of your Saved
          Groups to use Targeting Conditions. Everything is 100% backwards
          compatible and there&apos;s no need to do anything. Enjoy the new
          power and flexibility!
        </div>
      )}
      <div className="row align-items-center mb-1">
        <div className="col-auto">
          {groups.length > 0 && (
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          )}
        </div>
        <div className="flex-1"></div>
        {permissions.manageSavedGroups && (
          <div className="col-auto">
            <Button
              color="primary"
              onClick={async () => {
                setSavedGroupForm({});
              }}
            >
              <GBAddCircle /> Add Saved Group
            </Button>
          </div>
        )}
      </div>
      {groups.length > 0 && (
        <>
          <div className="row mb-2 align-items-center">
            <div className="col-auto"></div>
          </div>
          <div className="row mb-0">
            <div className="col-12">
              <table className="table appbox gbtable">
                <thead>
                  <tr>
                    <SortableTH field={"groupName"}>Name</SortableTH>
                    <th>Targeting Rules</th>
                    <SortableTH field={"owner"}>Owner</SortableTH>
                    <SortableTH field={"dateUpdated"}>Date Updated</SortableTH>
                    <SortableTH field={"usageCount"}>References</SortableTH>
                    {permissions.manageSavedGroups && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => {
                    return (
                      <tr key={s.id}>
                        <td>{s.groupName}</td>
                        <td>
                          <ConditionDisplay condition={s.condition} />
                        </td>
                        <td>{s.owner}</td>
                        <td>{ago(s.dateUpdated)}</td>
                        <td>
                          <Tooltip
                            body={
                              s.usageCount > 0 ? (
                                <div>
                                  Used in{" "}
                                  {s.features > 0 ? (
                                    <>
                                      <strong>{s.features}</strong> feature
                                      {s.features > 1 ? "s" : ""}
                                    </>
                                  ) : null}
                                  {s.experiments > 0 ? (
                                    <>
                                      {s.features > 0 ? " and " : ""}
                                      <strong>{s.experiments}</strong>{" "}
                                      experiment
                                      {s.experiments > 1 ? "s" : ""}
                                    </>
                                  ) : null}
                                  .
                                </div>
                              ) : (
                                ""
                              )
                            }
                          >
                            <span className="px-3 py-1">
                              {s.usageCount || 0}
                            </span>
                          </Tooltip>
                        </td>
                        {permissions.manageSavedGroups && (
                          <td style={{ width: 30 }}>
                            <MoreMenu>
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
                                  usage.get(s.id)?.all || []
                                )}
                                canDelete={!usage.get(s.id)?.all?.length}
                              />
                            </MoreMenu>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {!items.length && isFiltered && (
                    <tr>
                      <td
                        colSpan={permissions.manageSavedGroups ? 6 : 5}
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
