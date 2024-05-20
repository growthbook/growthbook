import React, { useState } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import { SDKAttribute } from "back-end/types/organization";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBAddCircle } from "@/components/Icons";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import AttributeModal from "@/components/Features/AttributeModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const FeatureAttributesPage = (): React.ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const { project } = useDefinitions();
  const attributeSchema = useAttributeSchema(true, project);

  const canCreateAttributes = permissionsUtil.canViewAttributeModal(project);

  const [modalData, setModalData] = useState<null | string>(null);
  const { refreshOrganization } = useUser();

  const drawRow = (v: SDKAttribute, i: number) => (
    <tr className={v.archived ? "disabled" : ""} key={i}>
      <td className="text-gray font-weight-bold">
        {v.property}{" "}
        {v.archived && (
          <span className="badge badge-secondary ml-2">archived</span>
        )}
      </td>
      <td className="text-gray">{v.description}</td>
      <td
        className="text-gray"
        style={{ maxWidth: "20vw", wordWrap: "break-word" }}
      >
        {v.datatype}
        {v.datatype === "enum" && <>: ({v.enum})</>}
        {v.format && (
          <p className="my-0">
            <small>(format: {v.format})</small>
          </p>
        )}
      </td>
      <td className="col-2">
        <ProjectBadges
          resourceType="attribute"
          projectIds={(v.projects || []).length > 0 ? v.projects : undefined}
          className="badge-ellipsis short align-middle"
        />
      </td>
      <td className="text-gray">{v.hashAttribute && <>yes</>}</td>
      <td>
        {permissionsUtil.canCreateAttribute(v) ? (
          <MoreMenu>
            {!v.archived && (
              <button
                className="dropdown-item"
                onClick={() => {
                  setModalData(v.property);
                }}
              >
                Edit
              </button>
            )}
            <button
              className="dropdown-item"
              onClick={async (e) => {
                e.preventDefault();
                const updatedAttribute: SDKAttribute = {
                  property: v.property,
                  datatype: v.datatype,
                  projects: v.projects,
                  format: v.format,
                  enum: v.enum,
                  hashAttribute: v.hashAttribute,
                  archived: !v.archived,
                };
                await apiCall<{
                  res: number;
                }>("/attribute", {
                  method: "PUT",
                  body: JSON.stringify(updatedAttribute),
                });
                refreshOrganization();
              }}
            >
              {v.archived ? "Unarchive" : "Archive"}
            </button>
            <DeleteButton
              displayName="Attribute"
              deleteMessage={
                <>
                  Are you sure you want to delete the{" "}
                  {v.hashAttribute ? "identifier " : ""}
                  {v.datatype} attribute:{" "}
                  <code className="font-weight-bold">{v.property}</code>?
                  <br />
                  This action cannot be undone.
                </>
              }
              className="dropdown-item text-danger"
              onClick={async () => {
                await apiCall<{
                  status: number;
                }>("/attribute/", {
                  method: "DELETE",
                  body: JSON.stringify({ id: v.property }),
                });
                refreshOrganization();
              }}
              text="Delete"
              useIcon={false}
            />
          </MoreMenu>
        ) : null}
      </td>
    </tr>
  );

  return (
    <>
      <div className="contents container-fluid pagecontents">
        <div className="mb-5">
          <div className="row mb-3 align-items-center">
            <div className="col">
              <div className="d-flex">
                <h1>Targeting Attributes</h1>
                {canCreateAttributes && (
                  <div className="ml-auto">
                    <button
                      className="btn btn-primary"
                      onClick={(e) => {
                        e.preventDefault();
                        setModalData("");
                      }}
                    >
                      <GBAddCircle /> Add Attribute
                    </button>
                  </div>
                )}
              </div>
              <p className="text-gray">
                These attributes can be used when targeting feature flags and
                experiments. Attributes set here must also be passed in through
                the SDK.
              </p>
            </div>
          </div>
          <table className="table gbtable appbox table-hover">
            <thead>
              <tr>
                <th>Attribute</th>
                <th>Description</th>
                <th>Data Type</th>
                <th>Projects</th>
                <th>
                  Identifier{" "}
                  <Tooltip body="Any attribute that uniquely identifies a user, account, device, or similar.">
                    <FaQuestionCircle
                      style={{ position: "relative", top: "-1px" }}
                    />
                  </Tooltip>
                </th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {attributeSchema?.length > 0 ? (
                <>{attributeSchema.map((v, i) => drawRow(v, i))}</>
              ) : (
                <>
                  <tr>
                    <td colSpan={3} className="text-center text-gray">
                      <em>No attributes defined.</em>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {modalData !== null && (
        <AttributeModal
          close={() => setModalData(null)}
          attribute={modalData}
        />
      )}
    </>
  );
};

export default FeatureAttributesPage;
