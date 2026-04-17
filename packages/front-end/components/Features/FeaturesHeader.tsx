import { useRouter } from "next/router";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { filterEnvironmentsByFeature, isDefined } from "shared/util";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiEye, PiWarning } from "react-icons/pi";
import { HoldoutInterface } from "shared/validators";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import Modal from "@/components/Modal";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import SortedTags from "@/components/Tags/SortedTags";
import { useWatching } from "@/services/WatchProvider";
import CompareFeatureEventsModal from "@/components/Features/CompareFeatureEventsModal";
import FeatureImplementationModal from "@/components/Features/FeatureImplementationModal";
import FeatureModal from "@/components/Features/FeatureModal";
import StaleDetectionModal from "@/components/Features/StaleDetectionModal";
import { FeatureTab } from "@/pages/features/[fid]";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Owner from "@/components/Avatar/Owner";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import Callout from "@/ui/Callout";
import Metadata from "@/ui/Metadata";
import { useHoldouts } from "@/hooks/useHoldouts";
import Link from "@/ui/Link";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import { useFeatureStaleStates } from "@/hooks/useFeatureStaleStates";
import { useScrollPosition } from "@/hooks/useScrollPosition";
import FeatureArchiveModal from "./FeatureArchiveModal";
import FeatureDeleteModal from "./FeatureDeleteModal";
import AddToHoldoutModal from "./AddToHoldoutModal";
export default function FeaturesHeader({
  feature,
  mutate,
  setVersion,
  version,
  revisions,
  tab,
  setTab,
  setEditFeatureInfoModal,
  holdout,
  isReadOnly = false,
}: {
  feature: FeatureInterface;
  mutate: () => Promise<unknown>;
  setVersion: (version: number) => void;
  version: number | null;
  revisions: MinimalFeatureRevisionInterface[];
  tab: FeatureTab;
  setTab: (tab: FeatureTab) => void;
  setEditFeatureInfoModal: (open: boolean) => void;
  holdout: HoldoutInterface | undefined;
  isReadOnly?: boolean;
}) {
  const router = useRouter();
  const projectId = feature?.project;
  const firstFeature = router?.query && "first" in router.query;
  const [auditModal, setAuditModal] = useState(false);
  const [watchersModal, setWatchersModal] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState(false);
  const [staleFFModal, setStaleFFModal] = useState(false);
  const [addToHoldoutModal, setAddToHoldoutModal] = useState(false);
  const [archiveModal, setArchiveModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [staleStatusOpen, setStaleStatusOpen] = useState(false);
  const [showImplementation, setShowImplementation] = useState(firstFeature);
  const { organization, hasCommercialFeature, users } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);

  const { apiCall } = useAuth();
  const { watchedFeatures, refreshWatching } = useWatching();
  const isWatching = watchedFeatures.includes(feature.id);
  const { data: watchersData } = useApi<{ userIds: string[] }>(
    `/feature/${feature.id}/watchers`,
  );
  const usersWatching = (watchersData?.userIds || [])
    .map((id) => users.get(id))
    .filter(isDefined)
    .map((u) => u.name || u.email);
  async function handleWatchUpdates(watch: boolean) {
    await apiCall(
      `/user/${watch ? "watch" : "unwatch"}/feature/${feature.id}`,
      {
        method: "POST",
      },
    );
    refreshWatching();
    setDropdownOpen(false);
  }
  const {
    getProjectById,
    project: currentProject,
    projects,
  } = useDefinitions();
  const { holdouts } = useHoldouts(feature.project);
  const holdoutsEnabled = hasCommercialFeature("holdouts");

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
  const tabsPinSentinelRef = useRef<HTMLDivElement>(null);
  const [headerPinned, setHeaderPinned] = useState(false);
  const { scrollY } = useScrollPosition();
  useEffect(() => {
    const el = tabsPinSentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setHeaderPinned(!entry.isIntersecting);
      },
      {
        root: null,
        rootMargin: `-${TABS_HEADER_HEIGHT_PX}px 0px 0px 0px`,
        threshold: 0,
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Portal the revisionAndSettingsGroup between the header and sticky tabs on scroll.
  // Moving a single DOM node keeps dropdown menus stable.
  const scrolled = scrollY > 15;
  const headerSlotRef = useRef<HTMLDivElement>(null);
  const tabsSlotRef = useRef<HTMLDivElement>(null);
  const [portalHost] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const div = document.createElement("div");
    div.style.display = "contents";
    return div;
  });
  useEffect(() => {
    if (!portalHost) return;
    const target = scrolled ? tabsSlotRef.current : headerSlotRef.current;
    if (target) target.appendChild(portalHost);
  }, [scrolled, portalHost]);

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

  const canEdit = permissionsUtil.canViewFeatureModal(projectId);
  const enabledEnvs = getEnabledEnvironments(feature, environments);
  const canPublish = permissionsUtil.canPublishFeature(feature, enabledEnvs);
  const isArchived = feature.archived;

  // Rendered once via a stable portal host (see above).
  const revisionAndSettingsGroup = (
    <Flex align="center" gap="4" pr="2">
      <RevisionDropdown
        feature={feature}
        revisions={revisions}
        version={version ?? feature.version}
        setVersion={setVersion}
        context="header"
      />
      <DropdownMenu
        trigger={
          <IconButton
            variant="ghost"
            color="gray"
            radius="full"
            size="2"
            highContrast
          >
            <BsThreeDotsVertical size={16} />
          </IconButton>
        }
        open={dropdownOpen}
        onOpenChange={setDropdownOpen}
        menuPlacement="end"
      >
        <DropdownMenuGroup>
          {canEdit && canPublish && !isReadOnly && (
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
          <DropdownSubMenu
            trigger={
              <Flex
                align="center"
                className={isWatching ? "font-weight-bold" : ""}
              >
                <PiEye style={{ marginRight: "5px" }} size={18} />
                <span className="pr-5">
                  {isWatching ? "Watching" : "Not watching"}
                </span>
              </Flex>
            }
          >
            <DropdownMenuItem
              onClick={async () => {
                await handleWatchUpdates(!isWatching);
              }}
            >
              {isWatching ? "Stop watching" : "Start watching"}
            </DropdownMenuItem>
          </DropdownSubMenu>
          <DropdownMenuItem
            onClick={() => {
              setWatchersModal(true);
              setDropdownOpen(false);
            }}
            disabled={!usersWatching.length}
          >
            <Flex as="div" align="center">
              <IconButton
                style={{
                  marginRight: "5px",
                  backgroundColor:
                    usersWatching.length > 0
                      ? "var(--violet-9)"
                      : "var(--slate-9)",
                }}
                radius="full"
                size="1"
              >
                {usersWatching.length || 0}
              </IconButton>
              {usersWatching.length > 0 ? "View watchers" : "No watchers"}
            </Flex>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {canEdit &&
          canPublish &&
          holdoutsEnabled &&
          holdouts.length > 0 &&
          !holdout?.id &&
          !isReadOnly && (
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
          {canEdit && canPublish && !isReadOnly && (
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
        {canEdit && canPublish && !isReadOnly && (
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
  );

  return (
    <>
      <Box className="features-header contents container-fluid pagecontents pb-0">
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

          <Flex align="start" justify="between" gap="2">
            <Flex align="center" mb="2" gap="3" style={{ marginTop: "-4px" }}>
              <Heading size="2x-large" as="h1" mb="0">
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
            {/* Slot: revisionAndSettingsGroup portal mounts here when not scrolled (>20px → tabs bar) */}
            <div ref={headerSlotRef} />
            {portalHost && createPortal(revisionAndSettingsGroup, portalHost)}
          </Flex>
          <Flex gap="4" align="center">
            {holdout?.id && (
              <Box>
                <Text weight="medium">Holdout: </Text>
                <Link href={`/holdout/${holdout.id}`}>{holdout.name}</Link>
              </Box>
            )}

            {(projects.length > 0 || projectIsDeReferenced) && (
              <Metadata
                label="Project"
                value={
                  <Flex gap="1">
                    {projectIsDeReferenced ? (
                      <Tooltip
                        body={
                          <>
                            Project <code>{projectId}</code> not found
                          </>
                        }
                      >
                        <span className="text-danger">
                          <PiWarning /> Invalid project
                        </span>
                      </Tooltip>
                    ) : currentProject && currentProject !== feature.project ? (
                      <Tooltip
                        body={<>This feature is not in your current project.</>}
                      >
                        {projectId && (
                          <Text weight="regular" color="text-mid">
                            {projectName}
                          </Text>
                        )}{" "}
                        <PiWarning className="text-warning" />
                      </Tooltip>
                    ) : projectId ? (
                      <Text weight="regular" color="text-mid">
                        {projectName}
                      </Text>
                    ) : canEdit && canPublish && !isReadOnly ? (
                      <Link
                        onClick={(e) => {
                          e.preventDefault();
                          setEditFeatureInfoModal(true);
                        }}
                      >
                        +Add
                      </Link>
                    ) : (
                      <Text weight="regular" color="text-mid">
                        None
                      </Text>
                    )}
                  </Flex>
                }
              />
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
              <Owner ownerId={feature.owner} gap="1" />
            </Box>
          </Flex>
          <Box mt="1" mb="3">
            {feature.tags?.length ? (
              <Box>
                <Text weight="medium">Tags: </Text>
                <SortedTags
                  tags={feature.tags || []}
                  useFlex
                  shouldShowEllipsis={false}
                />
              </Box>
            ) : null}
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
      <>
        <div
          ref={tabsPinSentinelRef}
          aria-hidden
          className="d-print-none"
          style={{
            height: 1,
            width: "100%",
            pointerEvents: "none",
          }}
        />
        <div
          className={clsx("feature-tabs d-print-none", {
            pinned: headerPinned,
          })}
        >
          <div className="container-fluid pagecontents px-3">
            <div className="header-tabs">
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList size="3" style={{ width: "100%" }}>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="test">Simulate</TabsTrigger>
                  <TabsTrigger value="stats">Code Refs</TabsTrigger>
                  <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
                  {/* Slot: revisionAndSettingsGroup portal mounts here when scrolled */}
                  <Box style={{ marginLeft: "auto", alignSelf: "center" }}>
                    <div ref={tabsSlotRef} />
                  </Box>
                </TabsList>
              </Tabs>
            </div>
          </div>
        </div>
      </>
      {auditModal && (
        <CompareFeatureEventsModal
          feature={feature}
          onClose={() => setAuditModal(false)}
        />
      )}
      {watchersModal && (
        <Modal
          trackingEventModalType=""
          open={true}
          header="Feature Watchers"
          close={() => setWatchersModal(false)}
          closeCta="Close"
        >
          <ul>
            {usersWatching.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
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
          revisionList={revisions}
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
          revisionList={revisions}
          mutate={mutate}
          setVersion={setVersion}
        />
      )}
      {archiveModal && (
        <FeatureArchiveModal
          feature={feature}
          close={() => setArchiveModal(false)}
          revisionList={revisions}
          mutate={mutate}
          setVersion={setVersion}
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
