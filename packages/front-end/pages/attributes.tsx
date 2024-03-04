import React, { useState } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import { SDKAttribute } from "back-end/types/organization";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBAddCircle } from "@/components/Icons";
import usePermissions from "@/hooks/usePermissions";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import AttributeModal from "@/components/Features/AttributeModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";

const FeatureAttributesPage = (): React.ReactElement => {
  const permissions = usePermissions();
  const { apiCall } = useAuth();
  const attributeSchema = useAttributeSchema(true);
  const { project } = useDefinitions();

  const canCreateAttributes = permissions.check(
    "manageTargetingAttributes",
    project
  );

  const [modalData, setModalData] = useState<null | string>(null);

  const [attributesForView, setAttributesForView] = useState(
    () => attributeSchema || []
  );

  const drawRow = (v: SDKAttribute, i: number) => (
    <tr className={v.archived ? "disabled" : ""} key={i}>
      <td className="text-gray font-weight-bold">
        {v.property}{" "}
        {v.archived && (
          <span className="badge badge-secondary ml-2">archived</span>
        )}
      </td>
      <td className="text-gray">
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
        {permissions.check("manageTargetingAttributes", v.projects || []) ? (
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
                try {
                  const res = await apiCall<{
                    res: number;
                    attributeSchema: SDKAttribute[];
                  }>(`/attribute/${v.property}`, {
                    method: "PUT",
                    body: JSON.stringify({
                      property: v.property,
                      datatype: v.datatype,
                      projects: v.projects,
                      format: v.format,
                      enum: v.enum,
                      hashAttribute: v.hashAttribute,
                      archived: !v.archived,
                    }),
                  });
                  setAttributesForView(res.attributeSchema);
                } catch (e) {
                  console.error(e);
                }
              }}
            >
              {v.archived ? "Unarchive" : "Archive"}
            </button>
            <DeleteButton
              displayName="Attribute"
              className="dropdown-item text-danger"
              onClick={async () => {
                const res = await apiCall<{
                  status: number;
                  attributeSchema: SDKAttribute[];
                }>(`/attribute/${v.property}`, {
                  method: "DELETE",
                });
                setAttributesForView(res.attributeSchema);
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
              {attributesForView?.length > 0 ? (
                <>{attributesForView.map((v, i) => drawRow(v, i))}</>
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
          setAttributesForView={setAttributesForView}
          attribute={modalData}
        />
      )}
    </>
  );
};

export default FeatureAttributesPage;
