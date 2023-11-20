import { SavedGroupInterface } from "back-end/types/saved-group";
import { useMemo, useState } from "react";
import { ago } from "shared/dates";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { useSearch } from "@/services/search";
import { getSavedGroupMessage } from "@/pages/saved-groups";
import LoadingOverlay from "../LoadingOverlay";
import Button from "../Button";
import { GBAddCircle } from "../Icons";
import Field from "../Forms/Field";
import MoreMenu from "../Dropdown/MoreMenu";
import DeleteButton from "../DeleteButton/DeleteButton";
import ClickToCopy from "../Settings/ClickToCopy";
import Code from "../SyntaxHighlighting/Code";
import SavedGroupForm from "./SavedGroupForm";

export interface Props {
  groups: SavedGroupInterface[];
  mutate: () => void;
}

export default function RuntimeGroupsList({ groups, mutate }: Props) {
  const [
    savedGroupForm,
    setSavedGroupForm,
  ] = useState<null | Partial<SavedGroupInterface>>(null);
  const permissions = usePermissions();
  const { apiCall } = useAuth();

  const environments = useEnvironments();

  const runtimeGroups = useMemo(() => {
    return groups.filter((g) => g.source === "runtime");
  }, [groups]);

  const { features } = useFeaturesList();

  const [runtimeInstructions, setRuntimeInstructions] = useState(false);

  // Get a list of feature ids for every saved group
  // TODO: also get experiments
  const savedGroupFeatureIds = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    features.forEach((feature) => {
      environments.forEach((env) => {
        if (feature.environmentSettings[env.id]?.rules) {
          feature.environmentSettings[env.id].rules.forEach((rule) => {
            runtimeGroups.forEach((group) => {
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
  }, [runtimeGroups, features, environments]);

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: runtimeGroups,
    localStorageKey: "savedGroupsRuntime",
    defaultSortField: "dateCreated",
    defaultSortDir: -1,
    searchFields: ["groupName^3", "attributeKey^2", "owner"],
  });

  if (!runtimeGroups) return <LoadingOverlay />;

  return (
    <div className="mb-5 appbox p-3 bg-white">
      {savedGroupForm && (
        <SavedGroupForm
          close={() => setSavedGroupForm(null)}
          current={savedGroupForm}
          runtime={true}
        />
      )}
      <div className="row align-items-center mb-1">
        <div className="col-auto">
          <h2 className="mb-0">Runtime Groups</h2>
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
              <GBAddCircle /> Add Runtime Group
            </Button>
          </div>
        )}
      </div>
      <p className="text-gray mb-1">
        With <strong>Runtime Groups</strong>, your application uses custom logic
        to determine which groups a user is in at runtime.
      </p>
      <p className="text-gray">
        For example, doing a database lookup to see if the user is in an
        &quot;Admin&quot; group.
      </p>
      {runtimeGroups.length > 0 && (
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
          <div className="row mb-3">
            <div className="col-12">
              <table className="table appbox gbtable">
                <thead>
                  <tr>
                    <SortableTH field={"groupName"}>Name</SortableTH>
                    <SortableTH field="attributeKey">
                      Group Identifier
                    </SortableTH>
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
                          <ClickToCopy compact>{s.attributeKey}</ClickToCopy>
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
                                  savedGroupFeatureIds[s.id]
                                )}
                                canDelete={
                                  (savedGroupFeatureIds[s.id]?.size || 0) === 0
                                }
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

          <div className="alert alert-info mb-0">
            <div className="mb-1">
              Runtime Groups require changes to your SDK implementation.
            </div>
            <div>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setRuntimeInstructions(!runtimeInstructions);
                }}
                className="font-weight-bold"
              >
                {runtimeInstructions ? "Hide" : "View"} Example{" "}
                {runtimeInstructions ? <FaAngleDown /> : <FaAngleRight />}
              </a>
            </div>
            {runtimeInstructions && (
              <div className="mt-2">
                <div>
                  <Code
                    language="javascript"
                    code={`
// Build an array of group identifier strings
const groups = [];

// TODO: actual logic for determining if the current user is in each group
${runtimeGroups
  .map(
    ({ attributeKey }) =>
      `if (true) groups.push(${JSON.stringify(attributeKey)});`
  )
  .join("\n")}

const gb = new GrowthBook({
  attributes: {
    "$groups": groups,
    //... other attributes
  },
  //...  other settings
})
          `.trim()}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
