import { useState, useEffect } from "react";
import {
  Box,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
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
import { useUser } from "@/services/UserContext";

const GetStartedPage = (): React.ReactElement => {
  const [showVideoId, setShowVideoId] = useState<string>("");
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { clearStep } = useGetStarted();

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

  const { data: sdkConnectionData } = useSDKConnections();
  const showSetUpFlow =
    canUseSetupFlow &&
    sdkConnectionData &&
    !organization.isVercelIntegration &&
    !sdkConnectionData.connections.some((c) => c.connected);

  // If they view the guide, clear the current step
  useEffect(() => {
    clearStep();
  }, [clearStep]);

  // Also used for the `Launch Setup Flow` button to keep it aligned
  const DOCUMENTATION_SIDEBAR_WIDTH = "minmax(0, 245px)";

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
        <Grid
          columns={{
            initial: "1fr 1fr",
            xs: `1fr ${DOCUMENTATION_SIDEBAR_WIDTH}`,
          }}
          mt="2"
          mb={{ initial: "4", xs: "6" }}
          justify="between"
          align="center"
        >
          <Heading as="h1" size="6" weight="medium" mb="0">
            Get Started
          </Heading>
        </Grid>

        <Grid
          columns={{
            initial: "1fr",
            xs: `1fr ${DOCUMENTATION_SIDEBAR_WIDTH}`,
          }}
          gapX="4"
          mb="6"
        >
          {showSetUpFlow && (
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
          )}
        </Grid>

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
              {!organization.isVercelIntegration ? (
                <>
                  <LaunchDarklyImportFeatureCard />
                  <AnalyzeExperimentFeatureCard />
                </>
              ) : null}
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
