import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import { FaExternalLinkAlt } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { getPrerequisites } from "@/services/features";
import usePermissions from "@/hooks/usePermissions";
import DeleteButton from "../DeleteButton/DeleteButton";
import MoreMenu from "../Dropdown/MoreMenu";
import ConditionDisplay from "./ConditionDisplay";

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
  parentFeature, // todo: check for invalid parents
  mutate,
  setPrerequisiteModal,
  version,
  setVersion,
  locked,
}: Props) {
  const { apiCall } = useAuth();

  const prerequisites = getPrerequisites(feature);
  const permissions = usePermissions();

  const canEdit =
    !locked &&
    permissions.check("manageFeatures", feature.project) &&
    permissions.check("createFeatureDrafts", feature.project);

  return (
    <div
      className={`mx-3 py-3 ${
        i < prerequisites.length ? "border-bottom" : ""
      } bg-white`}
    >
      <div className="d-flex align-items-center">
        <div className="flex-1 mr-2">
          {parentFeature?.id ? (
            <>
              <span className="mr-2">Prerequisite Feature:</span>
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
                      body: JSON.stringify({ i }),
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
      <div className="d-flex ml-2">
        <div
          style={{ maxWidth: "100%" }}
          className="pt-1 flex-1 position-relative"
        >
          <div className="row mb-1 align-items-top">
            <div className="col-auto d-flex align-items-center">
              <strong>ENABLED IF</strong>
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
