import {FeatureInterface, FeaturePrerequisite, FeatureRule} from "back-end/types/feature";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React, { forwardRef } from "react";
import {
  FaArrowsAlt,
  FaExclamationTriangle,
  FaExternalLinkAlt,
} from "react-icons/fa";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import {getPrerequisites, getRules, useEnvironments} from "@/services/features";
import usePermissions from "@/hooks/usePermissions";
import { getUpcomingScheduleRule } from "@/services/scheduleRules";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "../Button";
import DeleteButton from "../DeleteButton/DeleteButton";
import MoreMenu from "../Dropdown/MoreMenu";
import ConditionDisplay from "./ConditionDisplay";
import ForceSummary from "./ForceSummary";
import RolloutSummary from "./RolloutSummary";
import ExperimentSummary from "./ExperimentSummary";
import RuleStatusPill from "./RuleStatusPill";
import ExperimentRefSummary, {
  isExperimentRefRuleSkipped,
} from "./ExperimentRefSummary";
import ValidateValue from "@/components/Features/ValidateValue";

interface Props {
  i: number;
  prerequisite: FeaturePrerequisite;
  feature: FeatureInterface;
  parentFeature?: FeatureInterface;
  mutate: () => void;
  setPrerequisiteModal: (prerequisite: { i: number }) => void;
  version: number;
  setVersion: (version: number) => void;
  locked: boolean;
}

export default function Prerequisite({
  i,
  prerequisite,
  feature,
  parentFeature,  // todo: check for invalid parents
  mutate,
  setPrerequisiteModal,
  version,
  setVersion,
  locked,
}: Props) {
  const {apiCall} = useAuth();

  const prerequisites = getPrerequisites(feature);
  const permissions = usePermissions();

  const canEdit =
    !locked &&
    permissions.check("manageFeatures", feature.project) &&
    permissions.check("createFeatureDrafts", feature.project);

  const prerequisiteDisabled = !prerequisite.enabled;

  return (
    <div
      className={`p-3 ${
        i < prerequisites.length - 1 ? "border-bottom" : ""
      } bg-white`}
    >
      <div className="d-flex mb-2 align-items-center">
        <div>
          <Tooltip body={prerequisiteDisabled ? "This prerequisite will be skipped" : ""}>
            <div
              className={`text-light border rounded-circle text-center font-weight-bold ${
                prerequisiteDisabled ? "bg-secondary" : "bg-purple"
              }`}
              style={{
                width: 28,
                height: 28,
                lineHeight: "28px",
              }}
            >
              {i + 1}
            </div>
          </Tooltip>
        </div>
        <div className="flex-1 mx-2">
          {parentFeature?.id ? (
            <>
              <div className="font-weight-bold">
                <span className="uppercase-title mr-2">Feature</span>
                <a href={`/features/${parentFeature.id}`} target="_blank">
                  {parentFeature.id}
                  <FaExternalLinkAlt className="ml-1" />
                </a>
              </div>
              {prerequisite.description ? (
                <div className="text-muted">{prerequisite.description}</div>
              ) : null}
            </>
          ) : (
            <>
              Invalid parent feature (<code>{prerequisite.parentId}</code>)
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
              <Button
                color=""
                className="dropdown-item"
                onClick={async () => {
                  track(
                    prerequisite.enabled
                      ? "Disable Prerequisite"
                      : "Enable Prerequisite",
                    {
                      prerequisiteIndex: i,
                    }
                  );
                  const res = await apiCall<{ version: number }>(
                    `/feature/${feature.id}/${version}/rule`,
                    {
                      method: "PUT",
                      body: JSON.stringify({
                        prerequisite: {
                          ...prerequisite,
                          enabled: !prerequisite.enabled,
                        },
                        i,
                      }),
                    }
                  );
                  await mutate();
                  res.version && setVersion(res.version);
                }}
              >
                {prerequisite.enabled ? "Disable" : "Enable"}
              </Button>
              <DeleteButton
                className="dropdown-item"
                displayName="Rule"
                useIcon={false}
                text="Delete"
                onClick={async () => {
                  track("Delete Prerequisite", {
                    prerequisiteIndex: i,
                  });
                  const res = await apiCall<{ version: number }>(
                    `/feature/${feature.id}/${version}/prerequisite`,
                    {
                      method: "DELETE",
                      body: JSON.stringify({i}),
                    }
                  );
                  await mutate();
                  res.version && setVersion(res.version);
                }}
              />
            </MoreMenu>
          )}
        </div>
      </div>
      <div className="d-flex">
        <div
          style={{
            maxWidth: "100%",
            opacity: prerequisiteDisabled ? 0.4 : 1,
          }}
          className="pt-1 flex-1 position-relative"
        >
          <div className="row mb-3 align-items-top">
            <div className="col-auto">
              <strong>IF</strong>
            </div>
            <div className="col">
            <ConditionDisplay
              condition={prerequisite?.parentCondition ?? ""}
            />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
