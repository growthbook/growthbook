import React, { useEffect, useMemo, useState } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import { SDKAttribute } from "back-end/types/organization";
import Tooltip from "../components/Tooltip/Tooltip";
import { GBEdit } from "../components/Icons";
import EditAttributesModal from "../components/Features/EditAttributesModal";
import usePermissions from "../hooks/usePermissions";
import MoreMenu from "../components/Dropdown/MoreMenu";
import { useAuth } from "../services/auth";
import { useAttributeSchema } from "../services/features";
import { useUser } from "../services/UserContext";

const FeatureAttributesPage = (): React.ReactElement => {
  const [editOpen, setEditOpen] = useState(false);
  const permissions = usePermissions();
  const { apiCall } = useAuth();
  let attributeSchema = useAttributeSchema(true);

  const orderedAttributes = useMemo(
    () => [
      ...attributeSchema.filter((o) => !o.archived),
      ...attributeSchema.filter((o) => o.archived),
    ],
    [attributeSchema]
  );

  const [attributesForView, setAttributesForView] = useState(orderedAttributes);
  const { refreshOrganization } = useUser();

  useEffect(() => {
    setAttributesForView(orderedAttributes);
  }, [orderedAttributes]);

  const drawRow = (v: SDKAttribute, i: number) => (
    <tr className={v.archived ? "disabled" : ""} key={i}>
      <td className="text-gray font-weight-bold">{v.property}</td>
      <td className="text-gray">
        {v.datatype}
        {v.datatype === "enum" && <>: ({v.enum})</>}
      </td>
      <td className="text-gray">{v.hashAttribute && <>yes</>}</td>
      <td className="text-gray">{v.archived && <>yes</>}</td>
      <td>
        <MoreMenu>
          <button
            className="dropdown-item"
            onClick={async (e) => {
              e.preventDefault();

              // update attributes as they render in the view (do not reorder after changing archived state)
              setAttributesForView(
                attributesForView.map((attribute) =>
                  attribute.property === v.property
                    ? { ...attribute, archived: !v.archived }
                    : attribute
                )
              );

              // update SDK attributes while preserving original order
              attributeSchema = attributeSchema.map((attribute) =>
                attribute.property === v.property
                  ? { ...attribute, archived: !v.archived }
                  : attribute
              );
              await apiCall(`/organization`, {
                method: "PUT",
                body: JSON.stringify({
                  settings: { attributeSchema },
                }),
              });

              await refreshOrganization();
            }}
          >
            {v.archived ? "Unarchive" : "Archive"}
          </button>
        </MoreMenu>
      </td>
    </tr>
  );

  return (
    <>
      <div className="contents container-fluid pagecontents">
        <div className="mb-5">
          <div className="row mb-3 align-items-center">
            <div className="col-auto">
              <h3>Targeting Attributes</h3>
              <p className="text-gray">
                These attributes can be used when targeting feature flags.
                Attributes set here must also be passed in through the SDK.
              </p>
            </div>
            <div style={{ flex: 1 }} />
            {permissions.manageTargetingAttributes && (
              <div className="col-auto">
                <button
                  className="btn btn-primary float-right"
                  onClick={() => {
                    setEditOpen(true);
                  }}
                >
                  <span className="h4 pr-2 m-0 d-inline-block align-top">
                    <GBEdit />
                  </span>
                  Edit Attributes
                </button>
              </div>
            )}
          </div>
          <table className="table gbtable appbox">
            <thead>
              <tr>
                <th>Attribute</th>
                <th>Data Type</th>
                <th>
                  Identifier{" "}
                  <Tooltip body="Any attribute that uniquely identifies a user, account, device, or similar.">
                    <FaQuestionCircle
                      style={{ position: "relative", top: "-1px" }}
                    />
                  </Tooltip>
                </th>
                <th>Archived</th>
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
                      <em>
                        No attributes defined{" "}
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setEditOpen(true);
                          }}
                        >
                          Add attributes now
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
      {editOpen && <EditAttributesModal close={() => setEditOpen(false)} />}
    </>
  );
};

export default FeatureAttributesPage;
