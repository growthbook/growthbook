import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { Box, Flex } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import LinkButton from "@/ui/LinkButton";
import Text from "@/ui/Text";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import ProjectBadges from "@/components/ProjectBadges";
import PopulationDefinition from "@/components/Populations/PopulationDefinition";
import PopulationMoreMenu from "@/components/Populations/PopulationMoreMenu";
import { usePopulation } from "@/hooks/usePopulations";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import Custom404 from "@/pages/404";

export default function PopulationPage() {
  const router = useRouter();
  const { pid } = router.query;
  const gb = useGrowthBook<AppFeatures>();
  const populationsEnabled = !!gb?.isOn("populations");
  const { population, loading, error } = usePopulation(
    populationsEnabled && typeof pid === "string" ? pid : undefined,
  );
  const { getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

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

  const editHref = permissionsUtil.canUpdatePopulation(population, population)
    ? `/populations/${population.id}/edit`
    : null;
  const stepCount = population.steps.length;

  return (
    <Box className="pagecontents" style={{ margin: "0 auto" }}>
      <PageHead
        breadcrumb={[
          { display: "Populations", href: "/populations" },
          { display: population.name },
        ]}
      />

      <Flex justify="between" align="start" gap="3" mb="4">
        <Box>
          <Heading as="h1" size="xl" mb="2">
            {population.name}
          </Heading>
          <Flex align="center" gap="2" wrap="wrap">
            <Text size="sm" color="text-mid" mono>
              {population.userIdTypes.join(", ")}
            </Text>
            <Badge
              label={`${stepCount} ${stepCount === 1 ? "step" : "steps"}`}
              color="gray"
              variant="soft"
            />
            <Text size="sm" color="text-mid">
              {getDatasourceById(population.datasource)?.name ||
                population.datasource}
            </Text>
            <ProjectBadges
              resourceType="population"
              projectIds={
                population.projects.length ? population.projects : undefined
              }
            />
          </Flex>
          {population.description && (
            <Box mt="2" style={{ maxWidth: 640 }}>
              <Text color="text-mid">{population.description}</Text>
            </Box>
          )}
        </Box>
        <Flex gap="2" align="center">
          {editHref && (
            <LinkButton href={editHref} variant="outline">
              Edit
            </LinkButton>
          )}
          <PopulationMoreMenu
            population={population}
            showEdit={false}
            onDuplicated={(copy) => router.push(`/populations/${copy.id}`)}
            onDeleted={() => router.push("/populations")}
          />
        </Flex>
      </Flex>

      {/* The members card's large flex-grow keeps the Definition card at its
          base width until it wraps below. */}
      <Flex wrap="wrap" gap="4" align="start">
        <Box
          className="appbox"
          p="5"
          mb="0"
          minWidth="0"
          style={{ flex: "999 1 600px" }}
        >
          <Heading as="h2" size="md" mb="2">
            Members
          </Heading>
          <Text size="sm" color="text-mid">
            Member counts and the membership chart are coming soon. Membership
            is calculated when the population refreshes.
          </Text>
        </Box>
        <Box className="appbox" p="5" mb="0" style={{ flex: "1 1 280px" }}>
          <PopulationDefinition population={population} editHref={editHref} />
        </Box>
      </Flex>
    </Box>
  );
}
