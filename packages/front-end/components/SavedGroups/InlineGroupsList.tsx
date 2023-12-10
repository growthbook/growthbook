import { SavedGroupInterface } from "back-end/types/saved-group";
import { useMemo, useState } from "react";
import { ago } from "shared/dates";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
import { useSearch } from "@/services/search";
import { SavedGroupUsageMap, getSavedGroupMessage } from "@/pages/saved-groups";
import LoadingOverlay from "../LoadingOverlay";
import Button from "../Button";
import { GBAddCircle } from "../Icons";
import Field from "../Forms/Field";
import MoreMenu from "../Dropdown/MoreMenu";
import DeleteButton from "../DeleteButton/DeleteButton";
import ConditionDisplay from "../Features/ConditionDisplay";
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

  const inlineGroups = useMemo(() => {
    return groups.filter((g) => g.source === "inline");
  }, [groups]);

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: inlineGroups,
    localStorageKey: "savedGroups",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["groupName^3", "owner", "condition"],
  });

  if (!inlineGroups) return <LoadingOverlay />;

  return (
    <div className="mb-5 appbox p-3 bg-white">
      {savedGroupForm && (
        <SavedGroupForm
          close={() => setSavedGroupForm(null)}
          current={savedGroupForm}
          runtime={false}
          legacyTargetingUsage={
            usage.get(savedGroupForm.id || "")?.legacy || []
          }
        />
      )}
      <div className="row align-items-center mb-1">
        <div className="col-auto">
          <h2 className="mb-0">Inline Groups</h2>
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
              <GBAddCircle /> Add Inline Group
            </Button>
          </div>
        )}
      </div>
      <p className="text-gray mb-1">
        With <strong>Inline Groups</strong>, you define targeting rules and
        values directly within the GrowthBook UI.
      </p>
      <p className="text-gray">
        For example, a &quot;Beta Testers&quot; group containing a specific set
        of <code>device_id</code> values.
      </p>
      {inlineGroups.length > 0 && (
        <>
          <div className="row mb-2 align-items-center">
            <div className="col-auto">
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </div>
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
