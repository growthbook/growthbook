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
import Modal from "../components/Modal";
import HistoryTable from "../components/HistoryTable";

export default function SavedGroupsPage() {
  const [
    savedGroupForm,
    setSavedGroupForm,
  ] = useState<null | Partial<SavedGroupInterface>>(null);
  const permissions = usePermissions();

  const [auditModal, setAuditModal] = useState(false);
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
        {savedGroups.length > 0 && (
          <div
            className="col-auto ml-2"
            style={{ fontSize: "0.8em", lineHeight: "35px" }}
          >
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setAuditModal(true);
              }}
            >
              View Audit Log
            </a>
          </div>
        )}
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
              Saved Groups are defined set of attribute values which can be used
              with feature rules for targeting features at particular users.
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
        <>
          <p className="mb-3">
            Saved Groups are defined set of attribute values which can be used
            with feature rules for targeting features at particular users. For
            example, you might create a list of internal users.
          </p>
          <div className="alert alert-info mb-2">
            You don&apos;t have any saved groups defined yet.{" "}
            {permissions.manageSavedGroups && (
              <span>Click the button above to create your first one.</span>
            )}
          </div>
        </>
      )}
      {auditModal && (
        <Modal
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="max"
          closeCta="Close"
        >
          <HistoryTable type="savedGroup" id={"all"} />
        </Modal>
      )}
    </div>
  );
}
