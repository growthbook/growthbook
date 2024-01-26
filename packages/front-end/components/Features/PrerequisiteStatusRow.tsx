import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import { FaExclamationCircle, FaExternalLinkAlt } from "react-icons/fa";
import { evaluatePrerequisiteState, PrerequisiteState } from "shared/util";
import { Environment } from "back-end/types/organization";
import React, { useMemo } from "react";
import {
  FaRegCircleCheck,
  FaRegCircleQuestion,
  FaRegCircleXmark,
} from "react-icons/fa6";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import usePermissions from "@/hooks/usePermissions";
import Tooltip from "@/components/Tooltip/Tooltip";
import DeleteButton from "../DeleteButton/DeleteButton";
import MoreMenu from "../Dropdown/MoreMenu";

interface Props {
  i: number;
  prerequisite: FeaturePrerequisite;
  feature: FeatureInterface;
  features: FeatureInterface[];
  parentFeature?: FeatureInterface;
  environments: Environment[];
  mutate: () => void;
  setPrerequisiteModal: (prerequisite: { i: number }) => void;
}

export default function PrerequisiteStatusRow({
  i,
  prerequisite,
  feature,
  features,
  parentFeature,
  environments,
  mutate,
  setPrerequisiteModal,
}: Props) {
  const permissions = usePermissions();
  const canEdit = permissions.check("manageFeatures", feature.project);
  const { apiCall } = useAuth();

  const envs = environments.map((e) => e.id);

  const prereqStates = useMemo(() => {
    if (!parentFeature) return null;
    const states: Record<string, PrerequisiteState> = {};
    envs.forEach((env) => {
      states[env] = evaluatePrerequisiteState(parentFeature, features, env);
    });
    return states;
  }, [parentFeature, features, envs]);

  return (
    <tr>
      <td className="align-middle pl-3 border-right">
        <div className="d-flex">
          <div className="d-flex flex-1 align-items-center mr-2">
            {parentFeature?.id ? (
              <>
                <a
                  href={`/features/${parentFeature.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {parentFeature.id}
                  <FaExternalLinkAlt className="ml-1" />
                </a>
              </>
            ) : (
              <>
                Invalid parent feature (<code>{prerequisite.id}</code>)
              </>
            )}
          </div>
          <div>
            {canEdit && (
              <MoreMenu>
                <a
                  href="#"
                  className="dropdown-item"
                  onClick={(e) => {
                    e.preventDefault();
                    setPrerequisiteModal({ i });
                  }}
                >
                  Edit
                </a>
                <DeleteButton
                  className="dropdown-item"
                  displayName="Rule"
                  useIcon={false}
                  text="Delete"
                  onClick={async () => {
                    track("Delete Prerequisite", {
                      prerequisiteIndex: i,
                    });
                    await apiCall<{ version: number }>(
                      `/feature/${feature.id}/prerequisite`,
                      {
                        method: "DELETE",
                        body: JSON.stringify({ i }),
                      }
                    );
                    mutate();
                  }}
                />
              </MoreMenu>
            )}
          </div>
        </div>
      </td>
      <PrerequisiteStatesCols
        prereqStates={prereqStates ?? undefined}
        envs={envs}
      />
    </tr>
  );
}

export function PrerequisiteStatesCols({
  prereqStates,
  envs,
  isSummaryRow,
}: {
  prereqStates?: Record<string, PrerequisiteState>;
  envs: string[];
  isSummaryRow?: boolean;
}) {
  return (
    <>
      {envs.map((env) => (
        <td key={env} className="text-center">
          {prereqStates?.[env] === "on" && (
            <Tooltip
              className="cursor-pointer"
              popperClassName="text-left"
              body={
                <>
                  <div>
                    {isSummaryRow
                      ? "This feature"
                      : "This prerequisite feature"}{" "}
                    is currently enabled in this environment.
                  </div>
                </>
              }
            >
              <FaRegCircleCheck className="text-success" size={24} />
            </Tooltip>
          )}
          {prereqStates?.[env] === "off" && (
            <Tooltip
              className="cursor-pointer"
              popperClassName="text-left"
              body={
                <>
                  <div>
                    {isSummaryRow
                      ? "This feature"
                      : "This prerequisite feature"}{" "}
                    is currently disabled in this environment.
                    {isSummaryRow && (
                      <>
                        {" "}
                        It will evaluate to <code>null</code>.
                      </>
                    )}
                  </div>
                </>
              }
            >
              <FaRegCircleXmark className="text-muted" size={24} />
            </Tooltip>
          )}
          {prereqStates?.[env] === "conditional" && (
            <Tooltip
              className="cursor-pointer"
              popperClassName="text-left"
              body={
                isSummaryRow ? (
                  <>
                    <div>
                      This feature is conditionally enabled in this environment.
                      This feature&apos;s prerequisites have rules which may
                      make the result conditional.
                    </div>
                    {isSummaryRow && (
                      <div className="mt-2">
                        Prerequisites will be evaluated at runtime. If any
                        prerequisites do not pass, this feature will evaluate to{" "}
                        <code>null</code>.
                      </div>
                    )}
                  </>
                ) : (
                  <div>
                    This prerequisite feature is conditionally enabled in this
                    environment. The parent feature&apos;s prerequisites have
                    rules which may make the result conditional.
                  </div>
                )
              }
            >
              <FaRegCircleQuestion className="text-purple" size={24} />
            </Tooltip>
          )}
          {prereqStates?.[env] === "cyclic" && (
            <Tooltip
              className="cursor-pointer"
              popperClassName="text-left"
              body={<div>Circular dependency detected. Please fix.</div>}
            >
              <FaExclamationCircle className="text-warning-orange" size={24} />
            </Tooltip>
          )}
        </td>
      ))}
    </>
  );
}
