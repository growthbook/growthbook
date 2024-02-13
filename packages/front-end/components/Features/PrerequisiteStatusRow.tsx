import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import { FaExclamationCircle } from "react-icons/fa";
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
import ValueDisplay from "@/components/Features/ValueDisplay";
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

  const prereqStatesAndDefaults = useMemo(() => {
    if (!parentFeature) return null;
    const states: Record<string, PrerequisiteState> = {};
    const defaultValues: Record<string, string> = {};
    envs.forEach((env) => {
      states[env] = evaluatePrerequisiteState(parentFeature, features, env);
      defaultValues[env] = parentFeature.defaultValue;
    });
    return { states, defaultValues };
  }, [parentFeature, features, envs]);

  return (
    <tr>
      <td className="align-middle pl-3 border-right">
        <div className="d-flex">
          <div className="d-flex flex-1 align-items-center mr-2">
            {parentFeature?.id ? (
              <>
                <a
                  className="d-flex align-items-center"
                  href={`/features/${parentFeature.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span
                    className="d-inline-block text-ellipsis"
                    style={{ maxWidth: 290 }}
                  >
                    {parentFeature.id}
                  </span>
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
        prereqStates={prereqStatesAndDefaults?.states}
        defaultValues={prereqStatesAndDefaults?.defaultValues}
        envs={envs}
      />
      <td />
    </tr>
  );
}

export function PrerequisiteStatesCols({
  prereqStates,
  defaultValues, // "true" | "false" defaultValues will override the UI for the "live" state
  envs,
  isSummaryRow = false,
}: {
  prereqStates?: Record<string, PrerequisiteState>;
  defaultValues?: Record<string, string>;
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
                      ? "The current feature"
                      : "This prerequisite feature"}{" "}
                    is{" "}
                    <span className="text-success font-weight-bold">live</span>{" "}
                    in this environment.
                    {defaultValues?.[env] === "true" && (
                      <div className="mt-2">
                        This prerequisite serves{" "}
                        <span className="rounded px-1 bg-light">
                          <ValueDisplay value={"true"} type="boolean" />
                        </span>{" "}
                        by default.
                      </div>
                    )}
                    {defaultValues?.[env] === "false" && (
                      <>
                        {" "}
                        However, this prerequisite serves{" "}
                        <span className="rounded px-1 bg-light">
                          <ValueDisplay value={"false"} type="boolean" />
                        </span>{" "}
                        by default. Therefore, it will block the current feature
                        from being live in this environment.
                      </>
                    )}
                  </div>
                </>
              }
            >
              {defaultValues?.[env] === "false" ? (
                <FaRegCircleXmark className="text-muted" size={24} />
              ) : (
                <FaRegCircleCheck className="text-success" size={24} />
              )}
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
                      ? "The current feature"
                      : "This prerequisite feature"}{" "}
                    is{" "}
                    <span className="text-gray font-weight-bold">not live</span>{" "}
                    in this environment.
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
                      The current feature is in a{" "}
                      <span className="text-purple font-weight-bold">
                        Schrödinger state
                      </span>{" "}
                      in this environment. We can&apos;t know whether it is live
                      or not until its prerequisites are evaluated at runtime in
                      the SDK.
                    </div>
                    {isSummaryRow && (
                      <div className="mt-2">
                        If any prerequisites do not pass at runtime, this
                        feature will evaluate to <code>null</code>.
                      </div>
                    )}
                  </>
                ) : (
                  <div>
                    This prerequisite is in a{" "}
                    <span className="text-purple font-weight-bold">
                      Schrödinger state
                    </span>{" "}
                    in this environment. We can&apos;t know its value until it
                    is evaluated at runtime in the SDK.
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
