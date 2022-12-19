import React, { useState } from "react";
import { CustomField } from "back-end/types/organization";
import { FaSortDown, FaSortUp } from "react-icons/fa";
import { useUser } from "@/services/UserContext";
import { useCustomFields } from "@/services/experiments";
import { useAuth } from "@/services/auth";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "../../hooks/usePermissions";
import { GBEdit } from "../../components/Icons";
import CustomFieldModal from "../../components/Settings/CustomFieldModal";

const CustomFieldsPage = (): React.ReactElement => {
  const [modalOpen, setModalOpen] = useState<Partial<CustomField> | null>(null);
  const permissions = usePermissions();
  const customFields = useCustomFields();
  const { apiCall } = useAuth();
  const { getProjectById } = useDefinitions();
  const { refreshOrganization, license, updateUser } = useUser();

  const reoderFields = async (i: number, dir: -1 | 1) => {
    [customFields[i + dir], customFields[i]] = [
      customFields[i],
      customFields[i + dir],
    ];
    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          customFields: customFields,
        },
      }),
    }).then(() => {
      updateUser();
    });
  };
  if (!license) {
    return (
      <div className="contents container-fluid pagecontents">
        <div className="mb-5">
          <div className="row mb-3 align-items-center">
            <div className="col-auto">
              <h3>Custom Experiment Fields</h3>
              <p className="text-gray"></p>
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-auto mb-2 alert alert-info py-2">
              Custom experiment fields are available for enterprise plans.
              Please upgrade your plan to access this feature.
            </div>
          </div>
        </div>
      </div>
    );
  }

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
            {permissions.manageCustomFields && (
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
          <table className="table gbtable appbox">
            <thead>
              <tr>
                <th style={{ width: "30px" }}></th>
                <th>Field Name</th>
                <th>Field Description</th>
                <th>Field Type</th>
                <th>Project</th>
                <th>Required</th>
                <th style={{ width: 75 }}></th>
              </tr>
            </thead>
            <tbody>
              {customFields?.length ? (
                <>
                  {customFields.map((v, i) => (
                    <tr key={i}>
                      <td>
                        <div className="d-flex flex-column">
                          <a
                            href="#"
                            className="inactivesort"
                            style={{ lineHeight: "11px" }}
                            onClick={(e) => {
                              e.preventDefault();
                              reoderFields(i, -1);
                            }}
                          >
                            {i !== 0 && <FaSortUp />}
                          </a>
                          <a
                            href="#"
                            className="inactivesort"
                            style={{ lineHeight: "11px" }}
                            onClick={(e) => {
                              e.preventDefault();
                              reoderFields(i, 1);
                            }}
                          >
                            {i !== customFields.length - 1 && <FaSortDown />}
                          </a>
                        </div>
                      </td>
                      <td className="text-gray font-weight-bold">{v.name}</td>
                      <td className="text-gray">{v.description}</td>
                      <td className="text-gray">
                        {v.type}
                        {(v.type === "enum" || v.type === "multiselect") && (
                          <>: ({v.values})</>
                        )}
                      </td>
                      <td className="text-gray">
                        {v.project ? getProjectById(v.project)?.name : ""}
                      </td>
                      <td className="text-gray">{v.required && <>yes</>}</td>
                      <td className="">
                        <a
                          href="#"
                          className="tr-hover"
                          onClick={(e) => {
                            e.preventDefault();
                            setModalOpen(v);
                          }}
                        >
                          <span className="h4 pr-2 m-0 d-inline-block align-top">
                            <GBEdit />
                          </span>
                        </a>
                        <DeleteButton
                          className="tr-hover h4 pr-2 m-0 d-inline-block align-top"
                          displayName="Custom Field"
                          useIcon={true}
                          link={true}
                          onClick={async () => {
                            const newCustomFields = [...customFields].filter(
                              (x) => x.id !== v.id
                            );
                            await apiCall(`/organization`, {
                              method: "PUT",
                              body: JSON.stringify({
                                settings: {
                                  customFields: newCustomFields,
                                },
                              }),
                            }).then(() => {
                              track("Delete Custom Experiment Field", {
                                type: v.type,
                              });
                              refreshOrganization();
                            });
                          }}
                        />
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
          onSuccess={refreshOrganization}
        />
      )}
    </>
  );
};

export default CustomFieldsPage;
