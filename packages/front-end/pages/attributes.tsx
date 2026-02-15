import React, { useMemo, useState } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import { BiShow } from "react-icons/bi";
import { SDKAttribute } from "shared/types/organization";
import { recursiveWalk } from "shared/util";
import { FeatureInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { SavedGroupWithoutValues } from "shared/types/saved-group";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import { useAttributeSchema, useFeaturesList } from "@/services/features";
import AttributeModal from "@/components/Features/AttributeModal";
import AttributeReferencesList from "@/components/Features/AttributeReferencesList";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useExperiments } from "@/hooks/useExperiments";
import Button from "@/ui/Button";
import Link from "@/ui/Link";

const FeatureAttributesPage = (): React.ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const { project, savedGroups } = useDefinitions();
  const attributeSchema = useAttributeSchema(true, project);

  const canCreateAttributes = permissionsUtil.canViewAttributeModal(project);

  const [modalData, setModalData] = useState<null | string>(null);
  const { refreshOrganization } = useUser();

  const { features } = useFeaturesList({ useCurrentProject: false });
  const { experiments } = useExperiments();

  const { attributeFeatures, attributeExperiments, attributeGroups } =
    useMemo(() => {
      const attributeKeys = attributeSchema.map((as) => as.property);
      const attributeFeatureIds: Record<string, Set<string>> = {};
      const attributeExperimentIds: Record<string, Set<string>> = {};
      const attributeGroupIds: Record<string, Set<string>> = {};

      for (const feature of features) {
        for (const envid in feature.environmentSettings) {
          const env = feature.environmentSettings?.[envid];
          env?.rules?.forEach((rule) => {
            try {
              const parsedCondition = JSON.parse(rule?.condition ?? "{}");
              recursiveWalk(parsedCondition, (node) => {
                if (attributeKeys.includes(node[0])) {
                  if (!attributeFeatureIds[node[0]])
                    attributeFeatureIds[node[0]] = new Set<string>();
                  attributeFeatureIds[node[0]].add(feature.id);
                }
              });
            } catch (e) {
              // ignore
            }
          });
        }
      }

      for (const experiment of experiments) {
        try {
          attributeExperimentIds[experiment.hashAttribute] ||=
            new Set<string>();
          attributeExperimentIds[experiment.hashAttribute].add(experiment.id);
          const phase = experiment.phases?.[experiment.phases.length - 1];
          const parsedCondition = JSON.parse(phase?.condition ?? "{}");
          recursiveWalk(parsedCondition, (node) => {
            if (attributeKeys.includes(node[0])) {
              if (!attributeExperimentIds[node[0]])
                attributeExperimentIds[node[0]] = new Set<string>();
              attributeExperimentIds[node[0]].add(experiment.id);
            }
          });
        } catch (e) {
          // ignore
        }
      }

      const conditionGroups = savedGroups.filter((g) => g.type === "condition");
      for (const group of conditionGroups) {
        try {
          const parsedCondition = JSON.parse(group?.condition ?? "{}");
          recursiveWalk(parsedCondition, (node) => {
            if (attributeKeys.includes(node[0])) {
              if (!attributeGroupIds[node[0]])
                attributeGroupIds[node[0]] = new Set<string>();
              attributeGroupIds[node[0]].add(group.id);
            }
          });
        } catch (e) {
          // ignore
        }
      }

      const attributeFeatures: Record<string, FeatureInterface[]> = {};
      const attributeExperiments: Record<
        string,
        ExperimentInterfaceStringDates[]
      > = {};
      const attributeGroups: Record<string, SavedGroupWithoutValues[]> = {};

      attributeKeys.forEach((a) => {
        attributeFeatures[a] = [...(attributeFeatureIds?.[a] ?? [])]
          .map((fid) => features.find((feature) => feature.id === fid))
          .filter(Boolean) as FeatureInterface[];
        attributeExperiments[a] = [...(attributeExperimentIds?.[a] ?? [])]
          .map((fid) => experiments.find((exp) => exp.id === fid))
          .filter(Boolean) as ExperimentInterfaceStringDates[];
        attributeGroups[a] = [...(attributeGroupIds?.[a] ?? [])]
          .map((gid) => savedGroups.find((group) => group.id === gid))
          .filter(Boolean) as SavedGroupWithoutValues[];
      });

      return { attributeFeatures, attributeExperiments, attributeGroups };
    }, [features, experiments, savedGroups, attributeSchema]);

  const [showReferencesModal, setShowReferencesModal] = useState<number | null>(
    null,
  );

  const drawRow = (v: SDKAttribute, i: number) => {
    const features = [...(attributeFeatures?.[v.property] ?? [])];
    const experiments = [...(attributeExperiments?.[v.property] ?? [])];
    const groups = [...(attributeGroups?.[v.property] ?? [])];

    const numReferences = features.length + experiments.length + groups.length;

    return (
      <tr className={v.archived ? "disabled" : ""} key={"attr-row-" + i}>
        <td className="text-gray font-weight-bold" style={{ width: "17%" }}>
          {v.property}{" "}
          {v.archived && (
            <span className="badge badge-secondary ml-2">archived</span>
          )}
        </td>
        <td className="text-gray" style={{ width: "38%" }}>
          {v.description}
        </td>
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
        <td className="">
          <ProjectBadges
            resourceType="attribute"
            projectIds={(v.projects || []).length > 0 ? v.projects : undefined}
          />
        </td>
        <td className="text-gray">
          {numReferences > 0 ? (
            <Link onClick={() => setShowReferencesModal(i)} className="nowrap">
              <BiShow /> {numReferences} reference
              {numReferences === 1 ? "" : "s"}
            </Link>
          ) : (
            <Tooltip body="No features, experiments, or condition groups reference this attribute.">
              <span
                className="nowrap"
                style={{ color: "var(--gray-10)", cursor: "not-allowed" }}
              >
                <BiShow /> 0 references
              </span>
            </Tooltip>
          )}
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
  };

  return (
    <>
      <div className="contents container-fluid pagecontents">
        <div className="mb-5">
          <div className="row mb-3 align-items-center">
            <div className="col">
              <div className="d-flex mb-1">
                <h1>Targeting Attributes</h1>
                {canCreateAttributes && (
                  <div className="ml-auto">
                    <Button onClick={() => setModalData("")}>
                      Add Attribute
                    </Button>
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
                <th>References</th>
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
                    <td colSpan={7} className="text-center text-gray">
                      <em>No attributes defined.</em>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {showReferencesModal !== null &&
        attributeSchema?.[showReferencesModal] && (
          <Modal
            header={`'${attributeSchema[showReferencesModal].property}' References`}
            trackingEventModalType="show-attribute-references"
            close={() => setShowReferencesModal(null)}
            open={true}
            useRadixButton={true}
            closeCta="Close"
          >
            <Text as="p" mb="3">
              This attribute is referenced by the following features,
              experiments, and condition groups.
            </Text>
            <AttributeReferencesList
              features={
                attributeFeatures?.[
                  attributeSchema[showReferencesModal].property
                ] ?? []
              }
              experiments={
                attributeExperiments?.[
                  attributeSchema[showReferencesModal].property
                ] ?? []
              }
              conditionGroups={
                attributeGroups?.[
                  attributeSchema[showReferencesModal].property
                ] ?? []
              }
            />
          </Modal>
        )}
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
