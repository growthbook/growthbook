import { SavedGroupInterface } from "back-end/types/saved-group";
import React, { useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import Button from "../components/Button";
import SavedGroupForm from "../components/SavedGroupForm";
import { GBAddCircle } from "../components/Icons";
import LoadingOverlay from "../components/LoadingOverlay";
import { ago } from "../services/dates";
import { useDefinitions } from "../services/DefinitionsContext";
import usePermissions from "../hooks/usePermissions";

export default function SavedGroupsPage() {
  const [
    savedGroupForm,
    setSavedGroupForm,
  ] = useState<null | Partial<SavedGroupInterface>>(null);
  const permissions = usePermissions();

  const { savedGroups, error } = useDefinitions();

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
                        {s.values.map((attribute, index) => {
                          if (index === s.values.length - 1) {
                            return attribute;
                          } else {
                            return `${attribute}, `;
                          }
                        })}
                      </td>
                      <td>{ago(s.dateUpdated)}</td>
                      {permissions.manageSavedGroups && (
                        <td>
                          <a
                            href="#"
                            className="tr-hover text-primary mr-3"
                            title="Edit this segment"
                            onClick={(e) => {
                              e.preventDefault();
                              setSavedGroupForm(s);
                            }}
                          >
                            <FaPencilAlt />
                          </a>
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
