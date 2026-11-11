import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { SavedGroupWithoutValues } from "shared/types/saved-group";
import { PiArrowSquareOut } from "react-icons/pi";
import { Flex, Heading, Text } from "@radix-ui/themes";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import IdLists from "@/components/SavedGroups/IdLists";
import RemoteGroups from "@/components/SavedGroups/RemoteGroups";
import ConditionGroups from "@/components/SavedGroups/ConditionGroups";
import SavedGroupReviews from "@/components/SavedGroups/SavedGroupReviews";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import { isCloud } from "@/services/env";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";

function isTab(hash: string) {
  return (
    hash === "idLists" ||
    hash === "conditionGroups" ||
    hash === "drafts" ||
    hash === "remoteGroups"
  );
}

export default function SavedGroupsPage() {
  const router = useRouter();
  const { mutateDefinitions } = useDefinitions();

  const { data, error, mutate } = useApi<{
    savedGroups: SavedGroupWithoutValues[];
  }>("/saved-groups");
  const allSavedGroups = useMemo(() => data?.savedGroups ?? [], [data]);
  const savedGroups = useMemo(
    () => allSavedGroups.filter((g) => !g.archived),
    [allSavedGroups],
  );

  const mutateGroups = async () => {
    await Promise.all([mutate(), mutateDefinitions()]);
  };

  const { refreshOrganization } = useUser();
  // The flag only applies on Cloud
  const remoteGroupsFlagOn = useFeatureIsOn("remote-saved-groups");
  const remoteGroupsEnabled = !isCloud() || remoteGroupsFlagOn;

  // Initialize activeTab from URL hash, default to conditionGroups
  const getInitialTab = () => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.slice(1); // Remove the #
      if (isTab(hash)) {
        return hash;
      }
    }
    return "conditionGroups";
  };

  const [activeTab, setActiveTab] = useState(getInitialTab);
  // The flag can load after the hash is read, so fall back when it's off
  const shownTab =
    activeTab === "remoteGroups" && !remoteGroupsEnabled
      ? "conditionGroups"
      : activeTab;

  // Sync activeTab with URL hash changes (e.g., browser back/forward)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (isTab(hash)) {
        setActiveTab(hash);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Drives the badge count next to the "Drafts" tab. Uses the lightweight
  // count endpoint so we don't have to fetch full revision documents.
  const { data: openReviewsCountData } = useApi<{ count: number }>(
    "/revision/count?entityType=saved-group",
  );
  const openReviewsCount = openReviewsCountData?.count ?? 0;

  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const attributeSchema = useAttributeSchema();
  const [idLists, conditionGroups, remoteGroups] = useMemo(
    () => [
      savedGroups.filter((g) => g.type === "list"),
      savedGroups.filter((g) => g.type === "condition"),
      savedGroups.filter((g) => g.type === "remote"),
    ],
    [savedGroups],
  );

  useEffect(() => {
    // Not using $groups attribute in a any saved groups
    if (
      !savedGroups?.some(
        (g) => g.type === "condition" && g.condition?.includes("$groups"),
      )
    ) {
      return;
    }

    // Already has $groups attribute
    if (attributeSchema.some((a) => a.property === "$groups")) return;

    // If user has permissions to manage attributes, auto-add $groups attribute
    //TODO: When we make Saved Groups a project-level feature, we should pass in the Saved Groups projects below
    if (permissionsUtil.canCreateAttribute({})) {
      apiCall<{ added: boolean }>("/organization/auto-groups-attribute", {
        method: "POST",
      })
        .then((res) => {
          if (res.added) {
            refreshOrganization();
          }
        })
        .catch(() => {
          // Ignore errors
        });
    }
  }, [
    apiCall,
    refreshOrganization,
    attributeSchema,
    savedGroups,
    permissionsUtil,
  ]);

  if (!data && !error) return <LoadingOverlay />;

  return (
    <div className="p-3 container-fluid pagecontents">
      <Flex align="center" justify="between" mb="3">
        <Heading size="7" as="h1">
          Saved Groups
        </Heading>
      </Flex>
      <Text as="p" mb="3" color="gray">
        Create reusable user groups as targets for Feature Flags or experiments.
      </Text>
      <HelperText status="info" my="4">
        {remoteGroupsEnabled
          ? "Learn more about using Condition Groups, ID Lists and Remote Groups."
          : "Learn more about using Condition Groups and ID Lists."}
        <Link
          href="https://docs.growthbook.io/features/targeting#saved-groups"
          target="_blank"
          rel="noreferrer"
          ml="1"
        >
          Docs <PiArrowSquareOut />
        </Link>
      </HelperText>

      {error ? (
        <Callout status="error" mb="3">
          There was an error loading the list of groups.
        </Callout>
      ) : (
        <>
          <Tabs
            value={shownTab}
            onValueChange={(newTab) => {
              setActiveTab(newTab);
              // Clear search query and update hash when switching tabs
              const searchParams = new URLSearchParams(
                router.query as Record<string, string>,
              );
              if (searchParams.has("q")) {
                searchParams.delete("q");
              }
              router.replace(
                {
                  pathname: router.pathname,
                  query: Object.fromEntries(searchParams),
                  hash: `#${newTab}`,
                },
                undefined,
                { shallow: true },
              );
            }}
          >
            <TabsList>
              <TabsTrigger value="conditionGroups">
                Condition Groups
                <span className="ml-2 round-text-background text-main">
                  {conditionGroups.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="idLists">
                ID Lists
                <span className="ml-2 round-text-background text-main">
                  {idLists.length}
                </span>
              </TabsTrigger>
              {remoteGroupsEnabled && (
                <TabsTrigger value="remoteGroups">
                  Remote Groups
                  <span
                    className="round-text-background text-main"
                    style={{ marginLeft: 8 }}
                  >
                    {remoteGroups.length}
                  </span>
                </TabsTrigger>
              )}
              <TabsTrigger value="drafts">
                Drafts
                <span className="ml-2 round-text-background text-main">
                  {openReviewsCount}
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="conditionGroups">
              {/* Pass the archived-inclusive list so the `is:archived` facet can
                  surface archived groups (the list hides them by default). */}
              <ConditionGroups groups={allSavedGroups} mutate={mutateGroups} />
            </TabsContent>

            <TabsContent value="idLists">
              <IdLists groups={allSavedGroups} mutate={mutateGroups} />
            </TabsContent>

            {remoteGroupsEnabled && (
              <TabsContent value="remoteGroups">
                <RemoteGroups groups={allSavedGroups} mutate={mutateGroups} />
              </TabsContent>
            )}

            <TabsContent value="drafts">
              <SavedGroupReviews />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
