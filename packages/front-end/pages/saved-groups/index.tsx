import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { SavedGroupWithoutValues } from "shared/types/saved-group";
import { PiArrowSquareOut } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import IdLists from "@/components/SavedGroups/IdLists";
import ConditionGroups from "@/components/SavedGroups/ConditionGroups";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import HistoryTable from "@/components/HistoryTable";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";

export default function SavedGroupsPage() {
  const router = useRouter();
  const { mutateDefinitions, savedGroups, error } = useDefinitions();

  const [auditModal, setAuditModal] = useState(false);

  // Initialize activeTab from URL hash, default to conditionGroups
  const getInitialTab = () => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.slice(1); // Remove the #
      if (hash === "idLists" || hash === "conditionGroups") {
        return hash;
      }
    }
    return "conditionGroups";
  };

  const [activeTab, setActiveTab] = useState(getInitialTab);

  // Sync activeTab with URL hash changes (e.g., browser back/forward)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash === "idLists" || hash === "conditionGroups") {
        setActiveTab(hash);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const { refreshOrganization } = useUser();

  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const attributeSchema = useAttributeSchema();
  const [idLists, conditionGroups] = useMemo(() => {
    const idLists: SavedGroupWithoutValues[] = [];
    const conditionGroups: SavedGroupWithoutValues[] = [];
    savedGroups.forEach((savedGroup) => {
      if (savedGroup.type === "condition") {
        conditionGroups.push(savedGroup);
      }
      if (savedGroup.type === "list") {
        idLists.push(savedGroup);
      }
    });
    return [idLists, conditionGroups];
  }, [savedGroups]);

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

  if (!savedGroups) return <LoadingOverlay />;

  return (
    <div className="p-3 container-fluid pagecontents">
      <Flex align="center" justify="between" mb="3">
        <Heading size="2x-large" as="h1">
          Saved Groups
        </Heading>
        <Box>
          <Link
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setAuditModal(true);
            }}
          >
            View Audit Logs
          </Link>
        </Box>
      </Flex>
      <Text as="p" mb="3" color="gray">
        Create reusable user groups as targets for feature flags or experiments.
      </Text>
      <HelperText status="info" my="4">
        Learn more about using Condition Groups and ID Lists.
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
            value={activeTab}
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
            </TabsList>

            <TabsContent value="conditionGroups">
              <ConditionGroups
                groups={savedGroups}
                mutate={mutateDefinitions}
              />
            </TabsContent>

            <TabsContent value="idLists">
              <IdLists groups={savedGroups} mutate={mutateDefinitions} />
            </TabsContent>
          </Tabs>
        </>
      )}

      {auditModal && (
        <Modal
          trackingEventModalType=""
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="max"
          closeCta="Close"
        >
          <HistoryTable type="savedGroup" showName={true} showType={false} />
        </Modal>
      )}
    </div>
  );
}
