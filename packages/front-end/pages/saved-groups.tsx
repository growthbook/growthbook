import { SavedGroupInterface } from "back-end/types/saved-group";
import React, { useMemo, useState } from "react";
import Button from "../components/Button";
import SavedGroupForm from "../components/SavedGroupForm";
import { GBAddCircle } from "../components/Icons";
import LoadingOverlay from "../components/LoadingOverlay";
import { ago } from "../services/dates";
import { useDefinitions } from "../services/DefinitionsContext";
import usePermissions from "../hooks/usePermissions";
import MoreMenu from "../components/Dropdown/MoreMenu";
import DeleteButton from "../components/DeleteButton/DeleteButton";
import { useFeaturesList } from "../services/features";
import Link from "next/link";
import { useAuth } from "../services/auth";

const getSavedGroupMessage = (
  featuresUsingSavedGroups: Set<string> | undefined
) => {
  return async () => {
    if (featuresUsingSavedGroups?.size > 0) {
      return (
        <div>
          <p className="alert alert-danger">
            <strong>Whoops!</strong> Before you can delete this saved group, you
            will need to update the feature
            {featuresUsingSavedGroups.size > 1 && "s"} listed below by removing
            any targeting conditions that rely on this saved group.
          </p>
          <ul
            className="border rounded bg-light pt-3 pb-3 overflow-auto"
            style={{ maxHeight: "200px" }}
          >
            {[...featuresUsingSavedGroups].map((feature) => {
              return (
                <li key={feature}>
                  <div className="d-flex">
                    <Link href={`/features/${feature}`}>
                      <a className="btn btn-link pt-1 pb-1">{feature}</a>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }
  };
};

export default function SavedGroupsPage() {
  const [
    savedGroupForm,
    setSavedGroupForm,
  ] = useState<null | Partial<SavedGroupInterface>>(null);
  const permissions = usePermissions();
  const { apiCall } = useAuth();
  const { mutateDefinitions, savedGroups, error } = useDefinitions();

  const { features } = useFeaturesList();

  // Get a list of feature ids for every saved group
  const savedGroupFeatureIds = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    features.forEach((feature) => {
      for (const env in feature.environmentSettings) {
        feature.environmentSettings[env].rules.forEach((rule) => {
          savedGroups.forEach((group) => {
            if (rule.condition.includes(group.id)) {
              map[group.id] = map[group.id] || new Set();
              map[group.id].add(feature.id);
            }
          });
        });
      }
    });
    return map;
  }, [savedGroups, features]);

  if (!savedGroups) return <LoadingOverlay />;

  return (
    <div className="p-3 container-fluid pagecontents">
      {savedGroupForm && (
        <SavedGroupForm
          close={() => setSavedGroupForm(null)}
          current={savedGroupForm}
        />
      )}
      <div className="row mb-3">
        <div className="col-auto d-flex">
          <h1>Saved Groups</h1>
        </div>
        <div style={{ flex: 1 }}></div>
        {permissions.manageSavedGroups && (
          <div className="col-auto">
            <Button
              color="primary"
              onClick={async () => {
                setSavedGroupForm({});
              }}
            >
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBAddCircle />
              </span>{" "}
              New Saved Group
            </Button>
          </div>
        )}
      </div>
      {error && (
        <div className="alert alert-danger">
          There was an error loading the list of groups.
        </div>
      )}
      {savedGroups.length > 0 && (
        <div className="row mb-4">
          <div className="col-12">
            <p>
              Saved Groups are defined comma separated lists of users based on a
              unique identifier - for example, you might create a list of
              internal users. These groups, used with feature rules, allow you
              allow you to quickly target lists of users.
            </p>
            <table className="table appbox gbtable table-hover">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Owner</th>
                  <th>Attribute</th>
                  <th className="d-none d-lg-table-cell">
                    Comma Separated List
                  </th>
                  <th>Date Updated</th>
                  {permissions.manageSavedGroups && <th></th>}
                </tr>
              </thead>
              <tbody>
                {savedGroups.map((s) => {
                  return (
                    <tr key={s.id}>
                      <td>{s.groupName}</td>
                      <td>{s.owner}</td>
                      <td>{s.attributeKey}</td>
                      <td
                        className="d-none d-md-table-cell text-truncate"
                        style={{ maxWidth: "100px" }}
                      >
                        {s.values.join(", ")}
                      </td>
                      <td>{ago(s.dateUpdated)}</td>
                      {permissions.manageSavedGroups && (
                        <td>
                          <MoreMenu id={"namespace" + s.id + "_actions"}>
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
                                mutateDefinitions({});
                              }}
                              getConfirmationContent={getSavedGroupMessage(
                                savedGroupFeatureIds[s.id]
                              )}
                              canDelete={
                                savedGroupFeatureIds[s.id]?.size &&
                                savedGroupFeatureIds[s.id]?.size === 0
                              }
                            />
                          </MoreMenu>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {savedGroups.length === 0 && (
        <div className="alert alert-info">
          You don&apos;t have any saved groups defined yet.{" "}
          {permissions.manageSavedGroups && (
            <span>Click the button above to create your first one.</span>
          )}
        </div>
      )}
    </div>
  );
}
