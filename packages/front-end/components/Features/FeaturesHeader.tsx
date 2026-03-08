import { useRouter } from "next/router";
import React, { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Box, Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { filterEnvironmentsByFeature } from "shared/util";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { FaExclamationTriangle } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiLink, PiCheck } from "react-icons/pi";
import { HoldoutInterface } from "shared/validators";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { useUser } from "@/services/UserContext";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import SortedTags from "@/components/Tags/SortedTags";
import WatchButton from "@/components/WatchButton";
import CompareFeatureEventsModal from "@/components/Features/CompareFeatureEventsModal";
import FeatureImplementationModal from "@/components/Features/FeatureImplementationModal";
import FeatureModal from "@/components/Features/FeatureModal";
import StaleDetectionModal from "@/components/Features/StaleDetectionModal";
import { FeatureTab } from "@/pages/features/[fid]";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import UserAvatar from "@/components/Avatar/UserAvatar";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
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
import { useFeatureStaleStates } from "@/hooks/useFeatureStaleStates";
import { useScrollPosition } from "@/hooks/useScrollPosition";
import FeatureArchiveModal from "./FeatureArchiveModal";
import FeatureDeleteModal from "./FeatureDeleteModal";
import AddToHoldoutModal from "./AddToHoldoutModal";
import styles from "./FeaturesHeader.module.scss";

export default function FeaturesHeader({
  feature,
  baseFeature,
  mutate,
  setVersion,
  version,
  revisions,
  loading,
  revisionLoading,
  tab,
  setTab,
  setEditFeatureInfoModal,
  holdout,
  copyLinkHref: _copyLinkHref,
  onCopyLink,
  copyLinkSuccess,
}: {
  feature: FeatureInterface;
  baseFeature: FeatureInterface;
  mutate: () => Promise<unknown>;
  setVersion: (version: number) => void;
  version: number | null;
  revisions: MinimalFeatureRevisionInterface[];
  loading?: boolean;
  revisionLoading?: boolean;
  tab: FeatureTab;
  setTab: (tab: FeatureTab) => void;
  setEditFeatureInfoModal: (open: boolean) => void;
  holdout: HoldoutInterface | undefined;
  /** Href for copy-link button (built from current version). */
  copyLinkHref?: string;
  onCopyLink?: () => void;
  copyLinkSuccess?: boolean;
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
  const [staleStatusOpen, setStaleStatusOpen] = useState(false);
  const [showImplementation, setShowImplementation] = useState(firstFeature);

  const { organization, hasCommercialFeature, getOwnerDisplay } = useUser();
  const ownerDisplay = getOwnerDisplay(feature.owner);
  const baseOwnerDisplay = getOwnerDisplay(baseFeature.owner);

  // Show a changed-label indicator when the viewed revision differs from live
  const isNonLive = feature !== baseFeature;
  const projectChanged = isNonLive && feature.project !== baseFeature.project;
  const ownerChanged = isNonLive && feature.owner !== baseFeature.owner;
  const tagsChanged =
    isNonLive &&
    JSON.stringify([...(feature.tags || [])].sort()) !==
      JSON.stringify([...(baseFeature.tags || [])].sort());

  // Renders a field label with an orange dot + underlined text when the field
  // has a pending draft change, wrapped in a tooltip showing the live value.
  const ChangedLabel = ({
    label,
    changed,
    liveNode,
  }: {
    label: string;
    changed: boolean;
    liveNode: React.ReactNode;
  }) => {
    if (!changed) {
      return <Text weight="medium">{label}: </Text>;
    }
    return (
      <Tooltip
        body={
          <>
            <span className={styles.changeDot} />
            <strong>
              <em>{label}</em> changed in this revision
            </strong>
            <br />
            Live: {liveNode}
          </>
        }
      >
        <Text weight="medium" style={{ cursor: "default" }}>
          <span className={styles.changeDot} />
          <span
            style={{
              textDecoration: "underline",
              textDecorationColor: "var(--amber-10)",
            }}
          >
            {label}
          </span>
          {": "}
        </Text>
      </Tooltip>
    );
  };
  const permissionsUtil = usePermissionsUtil();
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
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

  const staleHook = useFeatureStaleStates();
  const staleData = staleHook.getStaleState(feature.id);

  // Initial fetch when navigating to a feature (uses cache if fresh).
  useEffect(() => {
    staleHook.fetchSome([feature.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature.id]);

  // Sticky tabs header — mirrors the experiment page pattern
  // NB: Keep in sync with .feature-tabs top property in global.scss
  const TABS_HEADER_HEIGHT_PX = 55;
  const tabsRef = useRef<HTMLDivElement>(null);
  const [headerPinned, setHeaderPinned] = useState(false);
  const { scrollY } = useScrollPosition();
  useEffect(() => {
    if (!tabsRef.current) return;
    setHeaderPinned(
      tabsRef.current.getBoundingClientRect().top <= TABS_HEADER_HEIGHT_PX,
    );
  }, [scrollY]);

  // Re-compute whenever the feature is saved (version increments on publish).
  const prevVersionRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      prevVersionRef.current !== null &&
      prevVersionRef.current !== feature.version
    ) {
      staleHook.invalidate([feature.id]);
      staleHook.fetchSome([feature.id]);
    }
    prevVersionRef.current = feature.version ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature.id, feature.version]);

  const handleRerunStale = async () => {
    staleHook.invalidate([feature.id]);
    await staleHook.fetchSome([feature.id]);
  };

  const project = getProjectById(projectId || "");
  const projectName = project?.name || null;
  const projectIsDeReferenced = projectId && !projectName;

  const baseProjectId = baseFeature.project;
  const baseProject = getProjectById(baseProjectId || "");
  const baseProjectName = baseProject?.name || baseProjectId || null;

  const canEdit = permissionsUtil.canViewFeatureModal(projectId);
  const enabledEnvs = getEnabledEnvironments(feature, environments);
  const canPublish = permissionsUtil.canPublishFeature(feature, enabledEnvs);
  const isArchived = feature.archived;

  return (
    <>
      <Box className="features-header contents container-fluid pagecontents">
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
            <Flex align="center" mb="2" gap="3">
              <Heading size="7" as="h1" mb="0">
                {feature.id}
              </Heading>
              <StaleFeatureIcon
                neverStale={feature.neverStale}
                valueType={feature.valueType}
                staleData={staleData}
                fetchStaleData={handleRerunStale}
                onDisable={canEdit ? () => setStaleFFModal(true) : undefined}
                open={staleStatusOpen}
                onOpenChange={setStaleStatusOpen}
              />
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
                  Audit history
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {canEdit &&
                canPublish &&
                holdoutsEnabled &&
                holdouts.length > 0 &&
                !holdout?.id && (
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setAddToHoldoutModal(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Add to holdout
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                )}
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setStaleStatusOpen(true);
                    setDropdownOpen(false);
                  }}
                >
                  Check stale status
                </DropdownMenuItem>
                {canEdit && canPublish && (
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
                )}
              </DropdownMenuGroup>
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
                  {isArchived && (
                    <>
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
                <ChangedLabel
                  label="Project"
                  changed={projectChanged}
                  liveNode={baseProjectName || <em>None</em>}
                />
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
              <ChangedLabel
                label="Owner"
                changed={ownerChanged}
                liveNode={
                  baseOwnerDisplay ? (
                    <span>
                      <UserAvatar
                        name={baseOwnerDisplay}
                        size="sm"
                        variant="soft"
                      />{" "}
                      {baseOwnerDisplay}
                    </span>
                  ) : (
                    <em>None</em>
                  )
                }
              />
              {ownerDisplay ? (
                <span>
                  <UserAvatar name={ownerDisplay} size="sm" variant="soft" />{" "}
                  {ownerDisplay}
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
              <ChangedLabel
                label="Tags"
                changed={tagsChanged}
                liveNode={
                  baseFeature.tags?.length ? (
                    <SortedTags
                      tags={baseFeature.tags}
                      useFlex
                      shouldShowEllipsis={false}
                    />
                  ) : (
                    <em>None</em>
                  )
                }
              />
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
        </Box>
      </Box>
      <div
        className={clsx("feature-tabs d-print-none", {
          pinned: headerPinned,
        })}
      >
        <div className="container-fluid pagecontents px-3">
          <div className="header-tabs" ref={tabsRef}>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList size="3" style={{ width: "100%" }}>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="test">Simulate</TabsTrigger>
                <TabsTrigger value="stats">Code Refs</TabsTrigger>
                <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
                <Box
                  style={{
                    marginLeft: "auto",
                    alignSelf: "center",
                    maxWidth: 480,
                  }}
                >
                  <Flex align="center" gap="3">
                    {onCopyLink && (
                      <Tooltip
                        body={copyLinkSuccess ? "Copied!" : "Copy link"}
                        tipPosition="bottom"
                        tipMinWidth="0"
                        style={{ marginBottom: -4 }}
                      >
                        <IconButton
                          variant="ghost"
                          size="2"
                          color="violet"
                          onClick={onCopyLink}
                        >
                          {copyLinkSuccess ? <PiCheck /> : <PiLink />}
                        </IconButton>
                      </Tooltip>
                    )}
                    <RevisionDropdown
                      feature={feature}
                      revisions={revisions}
                      version={version ?? feature.version}
                      setVersion={setVersion}
                      loading={loading}
                      revisionLoading={revisionLoading}
                    />
                  </Flex>
                </Box>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>
      {auditModal && (
        <CompareFeatureEventsModal
          feature={feature}
          onClose={() => setAuditModal(false)}
        />
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
          setVersion={setVersion}
          onEnable={handleRerunStale}
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
        />
      )}
    </>
  );
}
