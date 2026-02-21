import { useRouter } from "next/router";
import React, { useMemo, useState } from "react";
import { Box, Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { filterEnvironmentsByFeature, isFeatureStale } from "shared/util";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { FaExclamationTriangle } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import { HoldoutInterface } from "shared/validators";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { useUser } from "@/services/UserContext";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import SortedTags from "@/components/Tags/SortedTags";
import WatchButton from "@/components/WatchButton";
import Modal from "@/components/Modal";
import HistoryTable from "@/components/HistoryTable";
import FeatureImplementationModal from "@/components/Features/FeatureImplementationModal";
import FeatureModal from "@/components/Features/FeatureModal";
import StaleDetectionModal from "@/components/Features/StaleDetectionModal";
import { FeatureTab } from "@/pages/features/[fid]";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import UserAvatar from "@/components/Avatar/UserAvatar";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import Callout from "@/ui/Callout";
import ProjectBadges from "@/components/ProjectBadges";
import { useHoldouts } from "@/hooks/useHoldouts";
import Link from "@/ui/Link";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import FeatureArchiveModal from "./FeatureArchiveModal";
import FeatureDeleteModal from "./FeatureDeleteModal";
import AddToHoldoutModal from "./AddToHoldoutModal";

export default function FeaturesHeader({
  feature,
  features,
  experiments,
  mutate,
  tab,
  setTab,
  setEditFeatureInfoModal,
  holdout,
  dependentExperiments,
}: {
  feature: FeatureInterface;
  features: FeatureInterface[];
  experiments: ExperimentInterfaceStringDates[] | undefined;
  mutate: () => void;
  tab: FeatureTab;
  setTab: (tab: FeatureTab) => void;
  setEditFeatureInfoModal: (open: boolean) => void;
  holdout: HoldoutInterface | undefined;
  dependentExperiments: ExperimentInterfaceStringDates[];
}) {
  const router = useRouter();
  const projectId = feature?.project;
  const firstFeature = router?.query && "first" in router.query;
  const [auditModal, setAuditModal] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState(false);
  const [staleFFModal, setStaleFFModal] = useState(false);
  const [addToHoldoutModal, setAddToHoldoutModal] = useState(false);
  const [archiveModal, setArchiveModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showImplementation, setShowImplementation] = useState(firstFeature);

  const { organization, hasCommercialFeature } = useUser();
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
  const { holdouts } = useHoldouts(feature.project);
  const hasHoldoutsFeature = hasCommercialFeature("holdouts");
  const holdoutsEnabled =
    useFeatureIsOn("holdouts_feature") && hasHoldoutsFeature;

  const { stale, reason } = useMemo(() => {
    if (!feature) return { stale: false };
    return isFeatureStale({
      feature,
      features,
      experiments,
      dependentExperiments,
      environments: envs,
    });
  }, [feature, features, experiments, dependentExperiments, envs]);

  const project = getProjectById(projectId || "");
  const projectName = project?.name || null;
  const projectIsDeReferenced = projectId && !projectName;

  const canEdit = permissionsUtil.canViewFeatureModal(projectId);
  const enabledEnvs = getEnabledEnvironments(feature, environments);
  const canPublish = permissionsUtil.canPublishFeature(feature, enabledEnvs);
  const isArchived = feature.archived;

  return (
    <>
      <Box className="features-header contents container-fluid pagecontents mt-2">
        <Box>
          {projectId ===
            getDemoDatasourceProjectIdForOrganization(organization.id) && (
            <Callout status="info" mb="3">
              <Flex align="start" gap="6">
                <Box>
                  This feature is part of our sample dataset and shows how
                  Feature Flags and Experiments can be linked together. You can
                  delete this once you are done exploring.
                </Box>
                <Flex flexShrink="0">
                  <DeleteDemoDatasourceButton
                    onDelete={() => router.push("/features")}
                    source="feature"
                  />
                </Flex>
              </Flex>
            </Callout>
          )}

          <Flex align="center" justify="between">
            <Flex align="center" mb="2">
              <Heading size="7" as="h1" mb="0">
                {feature.id}
              </Heading>
              {stale && (
                <div className="ml-2">
                  <StaleFeatureIcon
                    staleReason={reason}
                    onClick={() => setStaleFFModal(true)}
                  />
                </div>
              )}
            </Flex>
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="3"
                  highContrast
                >
                  <BsThreeDotsVertical size={18} />
                </IconButton>
              }
              open={dropdownOpen}
              onOpenChange={setDropdownOpen}
              menuPlacement="end"
            >
              <DropdownMenuGroup>
                {canEdit && canPublish && (
                  <DropdownMenuItem
                    onClick={() => {
                      setEditFeatureInfoModal(true);
                      setDropdownOpen(false);
                    }}
                  >
                    Edit information
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    setShowImplementation(true);
                    setDropdownOpen(false);
                  }}
                >
                  Show implementation
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setAuditModal(true);
                    setDropdownOpen(false);
                  }}
                >
                  View Audit Log
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {canEdit && (
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => {
                      setStaleFFModal(true);
                      setDropdownOpen(false);
                    }}
                  >
                    {feature.neverStale
                      ? "Enable stale detection"
                      : "Disable stale detection"}
                  </DropdownMenuItem>
                  {canPublish &&
                    holdoutsEnabled &&
                    holdouts.length > 0 &&
                    !holdout?.id && (
                      <DropdownMenuItem
                        onClick={() => {
                          setAddToHoldoutModal(true);
                          setDropdownOpen(false);
                        }}
                      >
                        Add to holdout
                      </DropdownMenuItem>
                    )}
                </DropdownMenuGroup>
              )}
              {canEdit && canPublish && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setDuplicateModal(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setArchiveModal(true);
                        setDropdownOpen(false);
                      }}
                    >
                      {isArchived ? "Unarchive" : "Archive"}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      color="red"
                      onClick={() => {
                        setDeleteModal(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
            </DropdownMenu>
          </Flex>
          <Flex gap="4">
            {holdout?.id && (
              <Box>
                <Text weight="medium">Holdout: </Text>
                <Link href={`/holdout/${holdout.id}`}>{holdout.name}</Link>
              </Box>
            )}

            {(projects.length > 0 || projectIsDeReferenced) && (
              <Box>
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
                  <ProjectBadges
                    resourceType="feature"
                    projectIds={projectId ? [projectId] : []}
                  />
                ) : null}
                {canEdit && canPublish && !projectId && (
                  <a
                    role="button"
                    className="cursor-pointer button-link"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditFeatureInfoModal(true);
                    }}
                  >
                    +Add
                  </a>
                )}
              </Box>
            )}

            <Box>
              <Text weight="medium">Feature Key: </Text>
              {feature.id || "-"}
            </Box>

            <Box>
              <Text weight="medium">Type: </Text>
              {feature.valueType || "unknown"}
            </Box>

            <Box>
              <Text weight="medium">Owner: </Text>
              {feature.owner ? (
                <span>
                  <UserAvatar name={feature.owner} size="sm" variant="soft" />{" "}
                  {feature.owner}
                </span>
              ) : (
                <em className="text-muted">None</em>
              )}
            </Box>
            <Box>
              <WatchButton item={feature.id} itemType="feature" type="link" />
            </Box>
          </Flex>
          <Box mt="3" mb="4">
            <Box>
              <Text weight="medium">Tags: </Text>
              <SortedTags
                tags={feature.tags || []}
                useFlex
                shouldShowEllipsis={false}
              />
            </Box>
          </Box>
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
              <TabsTrigger value="test">Simulate</TabsTrigger>
              <TabsTrigger value="stats">Code Refs</TabsTrigger>
              <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
            </TabsList>
          </Tabs>
        </Box>
      </Box>
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
            const url = `/features/${feature.id}?new`;
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
      {addToHoldoutModal && (
        <AddToHoldoutModal
          close={() => setAddToHoldoutModal(false)}
          feature={feature}
          mutate={mutate}
        />
      )}
      {archiveModal && (
        <FeatureArchiveModal
          feature={feature}
          close={() => setArchiveModal(false)}
          onArchive={async () => {
            await apiCall(`/feature/${feature.id}/archive`, {
              method: "POST",
            });
            mutate();
          }}
          environments={envs}
        />
      )}
      {deleteModal && (
        <FeatureDeleteModal
          feature={feature}
          close={() => setDeleteModal(false)}
          onDelete={async () => {
            await apiCall(`/feature/${feature.id}`, {
              method: "DELETE",
            });
            await router.push("/features");
          }}
          environments={envs}
        />
      )}
    </>
  );
}
