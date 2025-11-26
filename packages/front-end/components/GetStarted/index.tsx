import { useState, useEffect, useMemo } from "react";
import {
  Box,
  Card,
  Container,
  Flex,
  Grid,
  Separator,
  Text,
} from "@radix-ui/themes";
import { PiArrowSquareOut, PiCaretDownFill } from "react-icons/pi";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { CommercialFeature } from "shared/src/enterprise/license-consts";
import router from "next/router";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { useGetStarted } from "@/services/GetStartedProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  AnalyzeExperimentFeatureCard,
  ExperimentFeatureCard,
  FeatureFlagFeatureCard,
  LaunchDarklyImportFeatureCard,
} from "@/components/GetStarted/FeaturedCards";
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";
import YouTubeLightBox from "@/components/GetStarted/YoutubeLightbox";
import OverviewCard from "@/components/GetStarted/OverviewCard";
import WorkspaceLinks from "@/components/GetStarted/WorkspaceLinks";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import useSDKConnections from "@/hooks/useSDKConnections";
import NeedingAttention from "@/components/GetStarted/NeedingAttention";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import { useFeaturesList } from "@/services/features";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import AdvancedFeaturesCard from "@/components/GetStarted/AdvancedFeaturesCard";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import FeatureModal from "@/components/Features/FeatureModal";
import { isCloud } from "@/services/env";
import { DocSection } from "@/components/DocLink";

type AdvancedFeature = {
  imgUrl: string;
  title: string;
  description: string;
  docSection: DocSection;
  commercialFeature?: CommercialFeature;
};

const advancedFeatureList: AdvancedFeature[] = [
  {
    imgUrl: "/images/get-started/advanced/metrics.jpg",
    title: "Metric Groups",
    description: "Easily reuse sets of metrics",
    docSection: "metricGroups",
    commercialFeature: "metric-groups",
  },
  {
    imgUrl: "/images/get-started/advanced/features.jpg",
    title: "Dev Tools",
    description: "Debug feature flags & experiments",
    docSection: "devTools",
  },
  {
    imgUrl: "/images/get-started/advanced/archetypes.png",
    title: "Archetype Overview",
    description: "Simulate the result of targeting rules",
    docSection: "archetypes",
    commercialFeature: "archetypes",
  },
  {
    imgUrl: "/images/get-started/advanced/custom-roles.png",
    title: "Custom Roles",
    description: "Define fine-grained permission control",
    docSection: "customRoles",
    commercialFeature: "custom-roles",
  },
  {
    imgUrl: "/images/get-started/advanced/teams.png",
    title: "Teams",
    description: "Manage member permissions",
    docSection: "team",
    commercialFeature: "teams",
  },
  {
    imgUrl: "/images/get-started/advanced/code-refs.png",
    title: "Code Refs",
    description: "See exactly where flags appear in code",
    docSection: "codeReferences",
    commercialFeature: "code-references",
  },
  {
    imgUrl: "/images/get-started/advanced/feature-flag.png", // don't have an image for this yet "/images/get-started/advanced/data-pipeline-mode.png",
    title: "Data Pipeline Mode",
    description: "Use temp tables for intermediate steps",
    docSection: "pipelineMode",
    commercialFeature: "pipeline-mode",
  },
  {
    imgUrl: "/images/get-started/advanced/fact-tables.png",
    title: "Query Optimization",
    description: "Improve SQL performance and reduce costs",
    docSection: "queryOptimization",
  },
];

const GetStartedAndHomePage = (): React.ReactElement => {
  const [showVideoId, setShowVideoId] = useState<string>("");
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { clearStep } = useGetStarted();
  const { features } = useFeaturesList();
  const { experiments } = useExperiments();
  const permissionsUtils = usePermissionsUtil();
  const { project } = useDefinitions();
  const { organization } = useUser();
  const [openNewExperimentModal, setOpenNewExperimentModal] =
    useState<boolean>(false);
  const canUseSetupFlow =
    permissionsUtils.canCreateSDKConnection({
      projects: [project],
      environment: "production",
    }) &&
    permissionsUtils.canCreateEnvironment({
      projects: [project],
      id: "production",
    });
  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization.id || "",
  );
  const hasFeatures = features.some((f) => f.project !== demoProjectId);
  const hasExperiments = experiments.some((e) => e.project !== demoProjectId);
  const orgIsUsingFeatureOrExperiment = hasFeatures || hasExperiments;

  const [showGettingStarted, setShowGettingStarted] = useState<boolean>(
    !orgIsUsingFeatureOrExperiment,
  );
  const [openNewFeatureFlagModal, setOpenNewFeatureFlagModal] =
    useState<boolean>(false);

  useEffect(() => {
    setShowGettingStarted(!orgIsUsingFeatureOrExperiment);
  }, [orgIsUsingFeatureOrExperiment]);

  const { data: sdkConnectionData } = useSDKConnections();
  const showSetUpFlow =
    canUseSetupFlow &&
    sdkConnectionData &&
    !sdkConnectionData.connections.some((c) => c.connected);

  // If they view the guide, clear the current step
  useEffect(() => {
    clearStep();
  }, [clearStep]);

  // Also used for the `Launch Setup Flow` button to keep it aligned
  const DOCUMENTATION_SIDEBAR_WIDTH = "minmax(0, 245px)";

  // Advanced Features Cards Section

  const advancedFeatures: AdvancedFeature[] = useMemo(() => {
    const advancedFeatureListWithAnalytics = [...advancedFeatureList];
    if (isCloud()) {
      advancedFeatureListWithAnalytics.push({
        imgUrl: "/images/get-started/advanced/feature-flag.png",
        title: "Feature Flag Analytics",
        description: "View flag evaluations in real time",
        docSection: "managedWarehouseTracking",
        commercialFeature: "managed-warehouse",
      });
    }
    return advancedFeatureListWithAnalytics
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
  }, []);

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="get-started"
          commercialFeature={null}
        />
      )}
      {openNewExperimentModal && (
        <NewExperimentForm
          onClose={() => setOpenNewExperimentModal(false)}
          source="home-page"
          isNewExperiment={true}
        />
      )}
      {openNewFeatureFlagModal && (
        <FeatureModal
          cta={"Create"}
          close={() => setOpenNewFeatureFlagModal(false)}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}${
              hasFeatures ? "?new" : "?first&new"
            }`;
            router.push(url);
          }}
        />
      )}
      {showVideoId && (
        <YouTubeLightBox
          close={() => setShowVideoId("")}
          videoId={showVideoId}
        />
      )}

      <Container
        px={{ initial: "2", xs: "4", sm: "7" }}
        py={{ initial: "1", xs: "3", sm: "6" }}
      >
        {orgIsUsingFeatureOrExperiment && (
          <Grid columns={`minmax(0, 1fr) ${DOCUMENTATION_SIDEBAR_WIDTH}`}>
            <Text size="7" weight="regular" mb="5" as="div">
              Home
            </Text>
            <Flex justify={{ initial: "end", sm: "start" }} align="center">
              <DropdownMenu
                trigger={
                  <Button icon={<PiCaretDownFill />} iconPosition="right">
                    Create
                  </Button>
                }
              >
                <DropdownMenuItem
                  onClick={() => {
                    setOpenNewFeatureFlagModal(true);
                  }}
                >
                  Feature Flag
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setOpenNewExperimentModal(true);
                  }}
                >
                  Experiment
                </DropdownMenuItem>
              </DropdownMenu>
            </Flex>
          </Grid>
        )}
        {!orgIsUsingFeatureOrExperiment && (
          <Text size="4" weight="medium" mb="3" as="div">
            Get Started
          </Text>
        )}
        <Grid
          columns={{
            initial: "1fr",
            sm: `minmax(0, 1fr) ${DOCUMENTATION_SIDEBAR_WIDTH}`,
          }}
          mb="3"
          gapX="4"
          rows="auto 1fr"
        >
          <Box>
            <Box>
              {orgIsUsingFeatureOrExperiment && (
                <Box>
                  <NeedingAttention />
                  <Box mt="6" mb="2">
                    <Box mb="3">
                      <Text
                        size="1"
                        weight="medium"
                        style={{ color: "var(--color-text-mid)" }}
                      >
                        EXPLORE ADVANCED FEATURES
                      </Text>
                    </Box>
                    <Flex direction={{ initial: "column", sm: "row" }} gap="4">
                      {advancedFeatures.map((feature) => (
                        <AdvancedFeaturesCard
                          key={feature.title}
                          imgUrl={feature.imgUrl}
                          docSection={feature.docSection}
                          title={feature.title}
                          description={feature.description}
                          commercialFeature={feature.commercialFeature}
                        />
                      ))}
                    </Flex>
                  </Box>
                </Box>
              )}

              <Flex
                direction="row"
                justify="between"
                mt={orgIsUsingFeatureOrExperiment ? "7" : undefined}
              >
                {orgIsUsingFeatureOrExperiment && (
                  <Text size="4" weight="medium" mb="3" as="div">
                    Get Started
                  </Text>
                )}
                {orgIsUsingFeatureOrExperiment && (
                  <Button
                    variant="ghost"
                    onClick={() => setShowGettingStarted(!showGettingStarted)}
                  >
                    {showGettingStarted ? "Hide Details" : "Show Details"}
                  </Button>
                )}
              </Flex>
              {!showGettingStarted && (
                <Callout status="info" size="md" mb="4">
                  <Text size="2">
                    Customize your account setup and learn how to get started
                    with GrowthBook.
                  </Text>
                </Callout>
              )}
              {showGettingStarted && (
                <>
                  {showSetUpFlow && (
                    <Callout status="wizard" size="md" mb="6">
                      Connect to your SDK to get started.{" "}
                      <Link
                        href="/setup"
                        className="font-weight-bold"
                        style={{ color: "inherit" }}
                      >
                        Launch the setup flow
                      </Link>{" "}
                      <PiArrowSquareOut />
                    </Callout>
                  )}
                  <Grid
                    gapX="4"
                    gapY="3"
                    columns={{ initial: "1fr", sm: "1fr 1fr" }}
                    rows="auto auto"
                  >
                    <FeatureFlagFeatureCard />
                    <ExperimentFeatureCard />
                    <LaunchDarklyImportFeatureCard />
                    <AnalyzeExperimentFeatureCard />
                  </Grid>

                  <Separator my="5" size="4" />

                  <Box mb="6">
                    <Box mb="3">
                      <Text size="1" weight="bold">
                        PRODUCT OVERVIEW
                      </Text>
                    </Box>

                    <Flex direction={{ initial: "column", sm: "row" }} gap="4">
                      <OverviewCard
                        imgUrl="/images/get-started/thumbnails/intro-to-growthbook.svg"
                        hoverText="Launch Video Player"
                        onClick={() => setShowVideoId("b4xUnDGRKRQ")}
                        playTime={5}
                        type="video"
                      />

                      <OverviewCard
                        imgUrl="/images/get-started/thumbnails/quantile-metrics-blog.png"
                        hoverText="View Blog Post"
                        href="https://blog.growthbook.io/measuring-a-b-test-impacts-on-website-latency-using-quantile-metrics-in-growthbook/"
                        type="link"
                      />

                      <OverviewCard
                        imgUrl="/images/get-started/thumbnails/4.2-release.png"
                        hoverText="View Blog Post"
                        href="https://blog.growthbook.io/growthbook-version-4-2/"
                        type="link"
                      />
                    </Flex>
                  </Box>

                  <Box mb="6">
                    <Box mb="3">
                      <Text size="1" weight="bold">
                        SET UP YOUR WORKSPACE
                      </Text>
                    </Box>

                    <Card>
                      <Grid columns={{ initial: "1fr", md: "1fr 1fr" }} pb="2">
                        <WorkspaceLinks />
                      </Grid>
                    </Card>
                  </Box>
                </>
              )}
            </Box>
          </Box>
          <Box
            mt={
              orgIsUsingFeatureOrExperiment
                ? { initial: "0", sm: "37px" }
                : undefined
            }
          >
            <DocumentationSidebar
              setUpgradeModal={setUpgradeModal}
              type="get-started"
            />
          </Box>
        </Grid>
      </Container>
    </>
  );
};

export default GetStartedAndHomePage;
