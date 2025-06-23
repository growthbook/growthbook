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
import { PiArrowSquareOut } from "react-icons/pi";
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
import NeedingAttentionPage from "@/pages/needing-attention";
import styles from "@/components/GetStarted/OverviewCard.module.scss";

const GetStartedPage = (): React.ReactElement => {
  const [showVideoId, setShowVideoId] = useState<string>("");
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { clearStep } = useGetStarted();

  const permissionsUtils = usePermissionsUtil();
  const { project } = useDefinitions();

  const canUseSetupFlow =
    permissionsUtils.canCreateSDKConnection({
      projects: [project],
      environment: "production",
    }) &&
    permissionsUtils.canCreateEnvironment({
      projects: [project],
      id: "production",
    });

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
      href: "/metrics",
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
      <NeedingAttentionPage />
      {/* Advanced Features Section */}
      <Box px={{ initial: "2", xs: "4", sm: "7" }} mt="6" mb="2">
        <Text size="3" weight="bold">
          Explore Advanced Features
        </Text>
        <Grid columns={{ initial: "1fr", sm: "1fr 1fr 1fr" }} gap="4" mt="3">
          {advancedFeatures.map((feature, i) => (
            <Link
              key={i}
              href={feature.href}
              style={{ textDecoration: "none" }}
            >
              <Card
                className={styles.card}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  minHeight: 200,
                  cursor: "pointer",
                }}
              >
                <Box
                  className={styles.advancedFeatureImage}
                  style={{ backgroundImage: `url(${feature.imgUrl})` }}
                />
                {/* Dark overlay for text readability */}
                <Box className={styles.advancedFeatureOverlay} />
                <Flex
                  direction="column"
                  justify="end"
                  height="100%"
                  style={{ position: "relative", zIndex: 3, minHeight: 200 }}
                  p="4"
                >
                  <Text
                    size="5"
                    weight="bold"
                    mb="1"
                    style={{ color: "white" }}
                  >
                    {feature.title}
                  </Text>
                  <Text size="3" style={{ color: "white" }}>
                    {feature.description}
                  </Text>
                </Flex>
              </Card>
            </Link>
          ))}
        </Grid>
      </Box>
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
        <Text size="4" weight="medium" mb="3" as="div">
          Get Started
        </Text>
        {showSetUpFlow && (
          <Grid
            columns={{
              initial: "1fr",
              xs: `1fr ${DOCUMENTATION_SIDEBAR_WIDTH}`,
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

        <Grid
          columns={{
            initial: "1fr",
            xs: `1fr ${DOCUMENTATION_SIDEBAR_WIDTH}`,
          }}
          mb="3"
          gapX="4"
        >
          <Box>
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

            {/* <Text size="1">
              Finished setting up?{" "}
              <Link weight="bold" href="#" underline="none">
                Turn off the guide to hide this page
              </Link>
            </Text> */}
          </Box>

          <Box>
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

export default GetStartedPage;
