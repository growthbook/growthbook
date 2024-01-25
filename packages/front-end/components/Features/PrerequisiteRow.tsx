import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import { FaExclamationCircle, FaExternalLinkAlt } from "react-icons/fa";
import { evaluatePrerequisiteState, PrerequisiteState } from "shared/util";
import { Environment } from "back-end/types/organization";
import { useMemo } from "react";
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

export default function PrerequisiteRow({
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
      {envs.map((env) => (
        <td key={env} className="text-center">
          {prereqStates?.[env] === "on" && (
            <Tooltip
              popperClassName="text-left mt-2"
              body="The parent feature is currently enabled in this environment"
            >
              <FaRegCircleCheck
                className="text-success cursor-pointer"
                size={24}
              />
            </Tooltip>
          )}
          {prereqStates?.[env] === "off" && (
            <Tooltip
              popperClassName="text-left mt-2"
              body="The parent feature is currently diabled in this environment"
            >
              <FaRegCircleXmark
                className="text-danger cursor-pointer"
                size={24}
              />
            </Tooltip>
          )}
          {prereqStates?.[env] === "conditional" && (
            <Tooltip
              popperClassName="text-left mt-2"
              body="The parent feature is currently enabled but has rules which make the result conditional in this environment"
            >
              <FaRegCircleQuestion
                className="text-black-50 cursor-pointer"
                size={24}
              />
            </Tooltip>
          )}
          {prereqStates?.[env] === "cyclic" && (
            <Tooltip
              popperClassName="text-left mt-2"
              body="Circular dependency detected. Please fix."
            >
              <FaExclamationCircle
                className="text-warning-orange cursor-pointer"
                size={24}
              />
            </Tooltip>
          )}
        </td>
      ))}
    </tr>
  );
}
