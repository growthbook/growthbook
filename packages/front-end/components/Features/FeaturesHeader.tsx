import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import { Text } from "@radix-ui/themes";
import { FeatureInterface } from "back-end/types/feature";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { filterEnvironmentsByFeature, isFeatureStale } from "shared/util";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { FaExclamationTriangle } from "react-icons/fa";
import { ImBlocked } from "react-icons/im";
import { useUser } from "@/services/UserContext";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBEdit } from "@/components/Icons";
import SortedTags from "@/components/Tags/SortedTags";
import WatchButton from "@/components/WatchButton";
import Modal from "@/components/Modal";
import HistoryTable from "@/components/HistoryTable";
import FeatureImplementationModal from "@/components/Features/FeatureImplementationModal";
import FeatureModal from "@/components/Features/FeatureModal";
import StaleDetectionModal from "@/components/Features/StaleDetectionModal";
import { FeatureTab } from "@/pages/features/[fid]";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import UserAvatar from "@/components/Avatar/UserAvatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/Radix/Tabs";

export default function FeaturesHeader({
  feature,
  features,
  experiments,
  mutate,
  tab,
  setTab,
  setEditProjectModal,
  setEditTagsModal,
  setEditOwnerModal,
  dependents,
}: {
  feature: FeatureInterface;
  features: FeatureInterface[];
  experiments: ExperimentInterfaceStringDates[] | undefined;
  mutate: () => void;
  tab: FeatureTab;
  setTab: (tab: FeatureTab) => void;
  setEditProjectModal: (open: boolean) => void;
  setEditTagsModal: (open: boolean) => void;
  setEditOwnerModal: (open: boolean) => void;
  dependents: number;
}) {
  const router = useRouter();
  const projectId = feature?.project;
  const firstFeature = router?.query && "first" in router.query;
  const [auditModal, setAuditModal] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState(false);
  const [staleFFModal, setStaleFFModal] = useState(false);
  const [showImplementation, setShowImplementation] = useState(firstFeature);

  const { organization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const envs = environments.map((e) => e.id);
  const { apiCall } = useAuth();
  const {
    getProjectById,
    project: currentProject,
    projects,
  } = useDefinitions();

  const { stale, reason } = useMemo(() => {
    if (!feature) return { stale: false };
    return isFeatureStale({
      feature,
      features,
      experiments,
      environments: envs,
    });
  }, [feature, features, experiments, envs]);

  const project = getProjectById(projectId || "");
  const projectName = project?.name || null;
  const projectIsDeReferenced = projectId && !projectName;

  const canEdit = permissionsUtil.canViewFeatureModal(projectId);
  const enabledEnvs = getEnabledEnvironments(feature, environments);
  const canPublish = permissionsUtil.canPublishFeature(feature, enabledEnvs);
  const isArchived = feature.archived;

  return (
    <>
      <div className="features-header pt-3 px-4">
        <div className="pagecontents mx-auto">
          {projectId ===
            getDemoDatasourceProjectIdForOrganization(organization.id) && (
            <div className="alert alert-info mb-3 d-flex align-items-center">
              <div className="flex-1">
                This feature is part of our sample dataset and shows how Feature
                Flags and Experiments can be linked together. You can delete
                this once you are done exploring.
              </div>
              <div style={{ width: 180 }} className="ml-2">
                <DeleteDemoDatasourceButton
                  onDelete={() => router.push("/features")}
                  source="feature"
                />
              </div>
            </div>
          )}

          <div className="row align-items-center mb-2">
            <div className="col-auto d-flex align-items-center">
              <h1 className="mb-0">{feature.id}</h1>
              {stale && (
                <div className="ml-2">
                  <StaleFeatureIcon
                    staleReason={reason}
                    onClick={() => setStaleFFModal(true)}
                  />
                </div>
              )}
            </div>
            <div style={{ flex: 1 }} />
            <div className="col-auto">
              <MoreMenu>
                <a
                  className="dropdown-item"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowImplementation(true);
                  }}
                >
                  Show implementation
                </a>
                {canEdit && (
                  <a
                    className="dropdown-item"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setStaleFFModal(true);
                    }}
                  >
                    {feature.neverStale
                      ? "Enable stale detection"
                      : "Disable stale detection"}
                  </a>
                )}
                {canEdit && canPublish && (
                  <a
                    className="dropdown-item"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setDuplicateModal(true);
                    }}
                  >
                    Duplicate
                  </a>
                )}
                {canEdit && canPublish && (
                  <Tooltip
                    shouldDisplay={dependents > 0}
                    usePortal={true}
                    body={
                      <>
                        <ImBlocked className="text-danger" /> This feature has{" "}
                        <strong>
                          {dependents} dependent{dependents !== 1 && "s"}
                        </strong>
                        . This feature cannot be archived until{" "}
                        {dependents === 1 ? "it has" : "they have"} been
                        removed.
                      </>
                    }
                  >
                    <ConfirmButton
                      onClick={async () => {
                        await apiCall(`/feature/${feature.id}/archive`, {
                          method: "POST",
                        });
                        mutate();
                      }}
                      modalHeader={
                        isArchived ? "Unarchive Feature" : "Archive Feature"
                      }
                      confirmationText={
                        isArchived ? (
                          <>
                            <p>
                              Are you sure you want to continue? This will make
                              the current feature active again.
                            </p>
                          </>
                        ) : (
                          <>
                            <p>
                              Are you sure you want to continue? This will make
                              the current feature inactive. It will not be
                              included in API responses or Webhook payloads.
                            </p>
                          </>
                        )
                      }
                      cta={isArchived ? "Unarchive" : "Archive"}
                      ctaColor="danger"
                      disabled={dependents > 0}
                    >
                      <button className="dropdown-item">
                        {isArchived ? "Unarchive" : "Archive"}
                      </button>
                    </ConfirmButton>
                  </Tooltip>
                )}
                {canEdit && canPublish && (
                  <Tooltip
                    shouldDisplay={dependents > 0}
                    usePortal={true}
                    body={
                      <>
                        <ImBlocked className="text-danger" /> This feature has{" "}
                        <strong>
                          {dependents} dependent{dependents !== 1 && "s"}
                        </strong>
                        . This feature cannot be deleted until{" "}
                        {dependents === 1 ? "it has" : "they have"} been
                        removed.
                      </>
                    }
                  >
                    <DeleteButton
                      useIcon={false}
                      displayName="Feature"
                      onClick={async () => {
                        await apiCall(`/feature/${feature.id}`, {
                          method: "DELETE",
                        });
                        await router.push("/features");
                      }}
                      className="dropdown-item text-danger"
                      text="Delete"
                      disabled={dependents > 0}
                    />
                  </Tooltip>
                )}
              </MoreMenu>
            </div>
          </div>
          <div className="mb-2 row">
            {(projects.length > 0 || projectIsDeReferenced) && (
              <div className="col-auto">
                <Text weight="medium">Project: </Text>
                {projectIsDeReferenced ? (
                  <Tooltip
                    body={
                      <>
                        Project <code>{projectId}</code> not found
                      </>
                    }
                  >
                    <span className="text-danger">
                      <FaExclamationTriangle /> Invalid project
                    </span>
                  </Tooltip>
                ) : currentProject && currentProject !== feature.project ? (
                  <Tooltip
                    body={<>This feature is not in your current project.</>}
                  >
                    {projectId ? <strong>{projectName}</strong> : null}{" "}
                    <FaExclamationTriangle className="text-warning" />
                  </Tooltip>
                ) : projectId ? (
                  <strong>{projectName}</strong>
                ) : null}
                {canEdit && canPublish && (
                  <Tooltip
                    shouldDisplay={dependents > 0}
                    body={
                      <>
                        <ImBlocked className="text-danger" /> This feature has{" "}
                        <strong>
                          {dependents} dependent{dependents !== 1 && "s"}
                        </strong>
                        . The project cannot be changed until{" "}
                        {dependents === 1 ? "it has" : "they have"} been
                        removed.
                      </>
                    }
                  >
                    {projectId && (
                      <a
                        className="ml-2 cursor-pointer"
                        onClick={() => {
                          dependents === 0 && setEditProjectModal(true);
                        }}
                      >
                        <GBEdit />
                      </a>
                    )}
                    {!projectId && (
                      <a
                        role="button"
                        className="cursor-pointer button-link"
                        onClick={(e) => {
                          e.preventDefault();
                          dependents === 0 && setEditProjectModal(true);
                        }}
                      >
                        +Add
                      </a>
                    )}
                  </Tooltip>
                )}
              </div>
            )}

            <div className="col-auto">
              <Text weight="medium">Type: </Text>
              {feature.valueType || "unknown"}
            </div>

            <div className="col-auto">
              <Text weight="medium">Owner: </Text>
              {feature.owner ? (
                <span>
                  <UserAvatar name={feature.owner} size="sm" variant="soft" />{" "}
                  {feature.owner}
                </span>
              ) : (
                <em className="text-muted">None</em>
              )}{" "}
              {canEdit && (
                <a
                  className="ml-1 cursor-pointer"
                  onClick={() => setEditOwnerModal(true)}
                >
                  <GBEdit />
                </a>
              )}
            </div>

            <div className="col-auto ml-auto">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setAuditModal(true);
                }}
              >
                View Audit Log
              </a>
            </div>
            <div className="col-auto">
              <WatchButton item={feature.id} itemType="feature" type="link" />
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-auto">
              <Text weight="medium">Tags: </Text>
              <SortedTags
                tags={feature.tags || []}
                useFlex
                shouldShowEllipsis={false}
              />
              {canEdit && (
                <a
                  className="ml-1 cursor-pointer"
                  onClick={() => setEditTagsModal(true)}
                >
                  <GBEdit />
                </a>
              )}
            </div>
          </div>
          <div>
            {isArchived && (
              <div className="alert alert-secondary mb-2">
                <strong>This feature is archived.</strong> It will not be
                included in SDK Endpoints or Webhook payloads.
              </div>
            )}
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList size="3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="stats">Code Refs</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      {auditModal && (
        <Modal
          trackingEventModalType=""
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="max"
          closeCta="Close"
        >
          <HistoryTable type="feature" id={feature.id} />
        </Modal>
      )}
      {duplicateModal && (
        <FeatureModal
          cta={"Duplicate"}
          close={() => setDuplicateModal(false)}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}`;
            await router.push(url);
          }}
          featureToDuplicate={feature}
        />
      )}
      {staleFFModal && (
        <StaleDetectionModal
          close={() => setStaleFFModal(false)}
          feature={feature}
          mutate={mutate}
        />
      )}
      {showImplementation && (
        <FeatureImplementationModal
          feature={feature}
          first={firstFeature}
          close={() => {
            setShowImplementation(false);
          }}
        />
      )}
    </>
  );
}
