import { useState } from "react";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { populationEndpoints } from "shared/api-endpoints";
import { Box, Flex } from "@radix-ui/themes";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";
import { GBEdit } from "@/components/Icons";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import HistoryTable from "@/components/HistoryTable";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import PopulationDefinition from "@/components/Populations/PopulationDefinition";
import PopulationMoreMenu from "@/components/Populations/PopulationMoreMenu";
import { usePopulation, useRefreshPopulations } from "@/hooks/usePopulations";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useRestApiCall } from "@/services/restApi";
import { useUser } from "@/services/UserContext";
import Custom404 from "@/pages/404";

export default function PopulationPage() {
  const router = useRouter();
  const { pid } = router.query;
  const gb = useGrowthBook<AppFeatures>();
  const populationsEnabled = !!gb?.isOn("populations");
  const refreshPopulations = useRefreshPopulations();
  const { population, loading, error } = usePopulation(
    populationsEnabled && typeof pid === "string" ? pid : undefined,
  );
  const { getDatasourceById, getProjectById, projects } = useDefinitions();
  const { getOwnerDisplay } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const restApiCall = useRestApiCall();
  const [editOwnerOpen, setEditOwnerOpen] = useState(false);
  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [auditLogOpen, setAuditLogOpen] = useState(false);

  if (!populationsEnabled) {
    return <Custom404 />;
  }
  if (error) {
    return (
      <Box className="pagecontents" style={{ margin: "0 auto" }}>
        <Callout status="error">{error.message}</Callout>
      </Box>
    );
  }
  if (loading || !population) {
    return <LoadingOverlay />;
  }

  const canEdit = permissionsUtil.canUpdatePopulation(population, {});
  const update = async (
    body: Partial<{ owner: string; projects: string[]; description: string }>,
  ) => {
    await restApiCall(populationEndpoints.updatePopulation, {
      params: { id: population.id },
      body,
    });
  };
  const refresh = () => refreshPopulations(population.id);

  return (
    <Box className="pagecontents" style={{ margin: "0 auto" }}>
      {editOwnerOpen && (
        <EditOwnerModal
          owner={population.owner}
          cancel={() => setEditOwnerOpen(false)}
          save={(owner) => update({ owner })}
          mutate={refresh}
        />
      )}
      {editProjectsOpen && (
        <EditProjectsForm
          label={<>Projects</>}
          value={population.projects}
          permissionRequired={(project) =>
            permissionsUtil.canUpdatePopulation({ projects: [project] }, {})
          }
          cancel={() => setEditProjectsOpen(false)}
          save={(projects) => update({ projects })}
          mutate={refresh}
          entityName="Population"
        />
      )}
      {auditLogOpen && (
        <ModalStandard
          trackingEventModalType=""
          open={true}
          header="Audit Log"
          close={() => setAuditLogOpen(false)}
          size="lg"
          closeCta="Close"
        >
          <HistoryTable type="population" id={population.id} />
        </ModalStandard>
      )}

      <PageHead
        breadcrumb={[
          { display: "Populations", href: "/populations" },
          { display: population.name },
        ]}
      />

      <Flex align="start" justify="between" gap="2" mb="2">
        <Heading as="h1" size="xl" overflowWrap="anywhere" mb="0">
          {population.name}
        </Heading>
        <Box pr="2">
          <PopulationMoreMenu
            population={population}
            onDuplicated={async (copy) => {
              await refreshPopulations();
              await router.push(`/populations/${copy.id}`);
            }}
            onDeleted={async () => {
              await refreshPopulations();
              await router.push("/populations");
            }}
            onAuditLog={() => setAuditLogOpen(true)}
          />
        </Box>
      </Flex>

      <Flex gap="4" align="center" wrap="wrap" mb="3">
        {projects.length > 0 && (
          <Metadata
            label="Projects"
            value={
              <Flex gap="1" align="center">
                {population.projects.length > 0 ? (
                  <Text weight="regular" color="text-mid">
                    {population.projects
                      .map((p) => getProjectById(p)?.name || p)
                      .join(", ")}
                  </Text>
                ) : (
                  <Text weight="regular" color="text-mid" fontStyle="italic">
                    All Projects
                  </Text>
                )}
                {canEdit && (
                  <Link
                    aria-label="Edit Projects"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditProjectsOpen(true);
                    }}
                  >
                    <GBEdit />
                  </Link>
                )}
              </Flex>
            }
          />
        )}
        <Metadata
          label="Owner"
          value={
            <Flex gap="1" align="center">
              <Text weight="regular" color="text-mid">
                {getOwnerDisplay(population.owner) || "None"}
              </Text>
              {canEdit && (
                <Link
                  aria-label="Edit owner"
                  onClick={() => setEditOwnerOpen(true)}
                >
                  <GBEdit />
                </Link>
              )}
            </Flex>
          }
        />
        <Metadata
          label="Data source"
          value={
            <Link href={`/datasources/${population.datasource}`} weight="bold">
              {getDatasourceById(population.datasource)?.name ||
                population.datasource}
            </Link>
          }
        />
        <Metadata
          label="Identifier types"
          value={
            <Text weight="regular" color="text-mid" mono>
              {population.userIdTypes.join(", ")}
            </Text>
          }
        />
      </Flex>

      <Frame px="5" pt="3" pb="4">
        <MarkdownInlineEdit
          canEdit={canEdit}
          canCreate={canEdit}
          value={population.description}
          save={async (description) => {
            await update({ description });
            await refresh();
          }}
        />
      </Frame>

      {/* The members card's large flex-grow keeps the Definition card at its
          base width until it wraps below. */}
      <Flex wrap="wrap" gap="4" align="start">
        <Frame
          px="5"
          py="5"
          mb="0"
          minWidth="0"
          style={{ flex: "999 1 600px" }}
        >
          <Heading as="h2" size="md" mb="2">
            Members
          </Heading>
          <Text size="sm" color="text-mid">
            Member counts and the membership chart are coming soon. Membership
            is calculated when the Population refreshes.
          </Text>
        </Frame>
        <Frame px="5" py="5" mb="0" minWidth="0" style={{ flex: "1 1 280px" }}>
          <PopulationDefinition population={population} />
        </Frame>
      </Flex>
    </Box>
  );
}
