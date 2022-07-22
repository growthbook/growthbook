import React, { useState } from "react";
import { GBEdit } from "../../components/Icons";
import usePermissions from "../../hooks/usePermissions";
import CustomFieldModal from "../../components/Settings/CustomFieldModal";
import { CustomField } from "back-end/types/organization";
import useUser from "../../hooks/useUser";
import { useCustomFields } from "../../services/experiments";

const CustomFieldsPage = (): React.ReactElement => {
  const [modalOpen, setModalOpen] = useState<Partial<CustomField> | null>(null);
  const permissions = usePermissions();
  const customFields = useCustomFields();
  const { update } = useUser();

  return (
    <>
      <div className="contents container-fluid pagecontents">
        <div className="mb-5">
          <div className="row mb-3 align-items-center">
            <div className="col-auto">
              <h3>Custom Experiment Fields</h3>
              <p className="text-gray"></p>
            </div>
            <div style={{ flex: 1 }} />
            {permissions.organizationSettings && (
              <div className="col-auto">
                <button
                  className="btn btn-primary float-right"
                  onClick={() => {
                    setModalOpen({});
                  }}
                >
                  <span className="h4 pr-2 m-0 d-inline-block align-top">
                    <GBEdit />
                  </span>
                  Add Custom Field
                </button>
              </div>
            )}
          </div>
          <table className="table gbtable">
            <thead>
              <tr>
                <th>Field Name</th>
                <th>Field Type</th>
                <th>Required</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {customFields?.length ? (
                <>
                  {customFields.map((v, i) => (
                    <tr key={i}>
                      <td className="text-gray font-weight-bold">{v.name}</td>
                      <td className="text-gray">
                        {v.type}
                        {v.type === "enum" && <>: ({v.values})</>}
                      </td>
                      <td className="text-gray">{v.required && <>yes</>}</td>
                      <td>
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setModalOpen(v);
                          }}
                        >
                          <span className="h4 pr-2 m-0 d-inline-block align-top">
                            <GBEdit />
                          </span>
                        </a>
                      </td>
                    </tr>
                  ))}
                </>
              ) : (
                <>
                  <tr>
                    <td colSpan={3} className="text-center text-gray">
                      <em>
                        No attributes defined{" "}
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setModalOpen({});
                          }}
                        >
                          Add custom field
                        </a>
                      </em>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {modalOpen && (
        <CustomFieldModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={update}
        />
      )}
    </>
  );
};

export default CustomFieldsPage;
