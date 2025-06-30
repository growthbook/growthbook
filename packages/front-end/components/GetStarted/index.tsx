import { useState, useEffect } from "react";
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
import Callout from "@/components/Radix/Callout";
import Link from "@/components/Radix/Link";
import useSDKConnections from "@/hooks/useSDKConnections";
import NeedingAttentionPage from "@/components/GetStarted/NeedingAttention";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@/components/Radix/DropdownMenu";
import Button from "@/components/Radix/Button";
import { useFeaturesList } from "@/services/features";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import AdvancedFeaturesCard from "@/components/GetStarted/AdvancedFeaturesCard";

const GetStartedAndHomePage = (): React.ReactElement => {
  const [showVideoId, setShowVideoId] = useState<string>("");
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { clearStep } = useGetStarted();
  const { features } = useFeaturesList();
  const { experiments } = useExperiments();
  const permissionsUtils = usePermissionsUtil();
  const { project } = useDefinitions();
  const { organization } = useUser();
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
    organization.id || ""
  );
  const hasFeatures = features.some((f) => f.project !== demoProjectId);
  const hasExperiments = experiments.some((e) => e.project !== demoProjectId);
  const orgIsUsingFeatureOrExperiment = hasFeatures || hasExperiments;

  const [showGettingStarted, setShowGettingStarted] = useState<boolean>(
    !orgIsUsingFeatureOrExperiment
  );

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
  const advancedFeatures = [
    {
      imgUrl: "/images/get-started/advanced/metrics.jpg",
      title: "Metric Groups",
      description: "Easily reuse sets of metrics",
      href: "/metrics#metricgroups",
    },
    {
      imgUrl: "/images/get-started/advanced/features.jpg",
      title: "Dev Tools",
      description: "Debug feature flags & experiments",
      href: "https://docs.growthbook.io/tools/chrome-extension",
    },
    {
      imgUrl: "/images/get-started/advanced/features.jpg",
      title: "Archetype Overview",
      description: "Simulate the result of targeting rules",
      href: "/archetypes",
    },
  ];

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="get-started"
          commercialFeature={null}
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
        {showSetUpFlow && (
          <Grid
            columns={{
              initial: "1fr",
              sm: `minmax(0, 1fr) ${DOCUMENTATION_SIDEBAR_WIDTH}`,
            }}
            gapX="4"
            mb="6"
          >
            <Callout status="wizard" size="md">
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
          </Grid>
        )}
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
                    open("feature-flags");
                  }}
                >
                  Feature Flag
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    open("experiments");
                  }}
                >
                  Experiment
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    open("datasources");
                  }}
                >
                  Datasource
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    open("fact-tables");
                  }}
                >
                  Fact Metric
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    open("archetypes");
                  }}
                >
                  Archetype
                </DropdownMenuItem>
              </DropdownMenu>
            </Flex>
          </Grid>
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
                  <NeedingAttentionPage />
                  <Box mt="6" mb="2">
                    <Box mb="3">
                      <Text
                        size="1"
                        weight="medium"
                        style={{ color: "var(--color-text-mid)" }}
                      >
                        Explore Advanced Features
                      </Text>
                    </Box>
                    <Flex direction={{ initial: "column", sm: "row" }} gap="4">
                      {advancedFeatures.map((feature) => (
                        <AdvancedFeaturesCard
                          key={feature.title}
                          imgUrl={feature.imgUrl}
                          href={feature.href}
                          title={feature.title}
                          description={feature.description}
                        />
                      ))}
                    </Flex>
                  </Box>
                </Box>
              )}
              <Flex direction="row" justify="between" mt="7">
                <Text size="4" weight="medium" mb="3" as="div">
                  Getting Started
                </Text>
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
                <Callout status="info" size="md">
                  <Text size="3">
                    Customize your account setup and learn how to get started
                    with GrowthBook.
                  </Text>
                </Callout>
              )}
              {showGettingStarted && (
                <>
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
                        imgUrl="/images/get-started/thumbnails/3.6-release.svg"
                        hoverText="View Blog Post"
                        href="https://blog.growthbook.io/growthbook-version-3-6/"
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

          <Box mt={{ initial: "0", sm: "37px" }}>
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
