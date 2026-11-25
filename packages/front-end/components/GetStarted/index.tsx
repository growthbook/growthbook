import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import { useState, useEffect, useMemo } from "react";
import { Box, Card, Flex, Grid, Separator, Text } from "@radix-ui/themes";
import { PiArrowSquareOut, PiCaretDownFill } from "react-icons/pi";
import { CommercialFeature } from "shared/enterprise";
import router from "next/router";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { useGetStarted } from "@/services/GetStartedProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  AnalyzeExperimentFeatureCard,
  ExperimentFeatureCard,
  FeatureFlagFeatureCard,
  ImportFromOtherPlatformFeatureCard,
  SampleDataFeatureCard,
  SetUpDataSourceAndMetricsFeatureCard,
} from "@/components/GetStarted/FeaturedCards";
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";
import YouTubeLightBox from "@/components/GetStarted/YoutubeLightbox";
import WorkspaceLinks from "@/components/GetStarted/WorkspaceLinks";
import { HomeMarketingBanner } from "@/components/Marketing/MarketingBanner";
import Callout from "@/ui/Callout";
import AutoRunCallout from "@/components/GetStarted/AutoRunCallout";
import Link from "@/ui/Link";
import useSDKConnections from "@/hooks/useSDKConnections";
import NeedingAttention from "@/components/GetStarted/NeedingAttention";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import { useUser } from "@/services/UserContext";
import AdvancedFeaturesCard from "@/components/GetStarted/AdvancedFeaturesCard";
import CreateExperimentModal from "@/components/Experiment/CreateExperimentModal";
import FeatureModal from "@/components/Features/FeatureModal";
import { isCloud } from "@/services/env";
import { isExperimentationLeaning } from "@/services/onboarding";
import { DocSection } from "@/components/DocLink";
import useApi from "@/hooks/useApi";
import useAgentOnboarding from "@/hooks/useAgentOnboarding";

type AdvancedFeature = (
  | { docSection: DocSection; href?: never }
  | { docSection?: never; href: string }
) & {
  imgUrl: string;
  title: MessageDescriptor;
  description: MessageDescriptor;
  commercialFeature?: CommercialFeature;
};

const dataScientistFeatureList: AdvancedFeature[] = [
  {
    imgUrl: "/images/get-started/advanced/fact-tables.png",
    title: msg`Fact Tables`,
    description: msg`Enable automatic query optimization`,
    href: "/fact-tables",
  },
  {
    imgUrl: "/images/get-started/advanced/metrics.jpg",
    title: msg`Metric Groups`,
    description: msg`Easily reuse sets of metrics`,
    href: "/metrics#metricgroups",
    commercialFeature: "metric-groups",
  },
  {
    imgUrl: "/images/get-started/advanced/data-pipeline.png",
    title: msg`Data Pipeline Mode`,
    description: msg`Use temp tables for intermediate steps`,
    docSection: "pipelineMode",
    commercialFeature: "pipeline-mode",
  },
];

const advancedFeatureList: AdvancedFeature[] = [
  {
    imgUrl: "/images/get-started/advanced/features.jpg",
    title: msg`Dev Tools`,
    description: msg`Debug feature flags & experiments`,
    docSection: "devTools",
  },
  {
    imgUrl: "/images/get-started/advanced/archetypes.png",
    title: msg`Archetype Overview`,
    description: msg`Simulate the result of targeting rules`,
    href: "/archetypes",
    commercialFeature: "archetypes",
  },
  {
    imgUrl: "/images/get-started/advanced/custom-roles.png",
    title: msg`Custom Roles`,
    description: msg`Define fine-grained permission control`,
    href: "/settings/team#roles",
    commercialFeature: "custom-roles",
  },
  {
    imgUrl: "/images/get-started/advanced/teams.png",
    title: msg`Teams`,
    description: msg`Manage member permissions`,
    href: "/settings/team#teams",
    commercialFeature: "teams",
  },
  {
    imgUrl: "/images/get-started/advanced/code-refs.png",
    title: msg`Code Refs`,
    description: msg`See exactly where flags appear in code`,
    docSection: "codeReferences",
    commercialFeature: "code-references",
  },
  {
    imgUrl: "/images/get-started/advanced/fact-tables.png",
    title: msg`Query Optimization`,
    description: msg`Improve SQL performance and reduce costs`,
    docSection: "queryOptimization",
  },
  ...dataScientistFeatureList,
];

const GetStartedAndHomePage = ({
  showMarketingBanner = false,
}: {
  showMarketingBanner?: boolean;
} = {}): React.ReactElement => {
  const { t, i18n } = useLingui();
  const [showVideoId, setShowVideoId] = useState<string>("");
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { clearStep } = useGetStarted();
  const permissionsUtils = usePermissionsUtil();
  const { project } = useDefinitions();
  const { organization } = useUser();

  const { data } = useApi<{ hasFeatures: boolean; hasExperiments: boolean }>(
    "/organization/feature-exp-usage",
  );

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
  const canCreateFeature = permissionsUtils.canCreateFeature(
    { project },
    NO_ENVIRONMENT_BINDING,
  );
  const canCreateExperiment = permissionsUtils.canCreateExperiment({
    project,
  });

  const hasFeatures = data?.hasFeatures || false;
  const hasExperiments = data?.hasExperiments || false;
  const orgIsUsingFeatureOrExperiment = hasFeatures || hasExperiments;

  const showDataScientistView = isExperimentationLeaning(
    organization?.demographicData,
  );

  const [showGettingStarted, setShowGettingStarted] = useState<boolean>(
    !orgIsUsingFeatureOrExperiment,
  );
  const [openNewFeatureFlagModal, setOpenNewFeatureFlagModal] =
    useState<boolean>(false);

  useEffect(() => {
    setShowGettingStarted(!orgIsUsingFeatureOrExperiment);
  }, [orgIsUsingFeatureOrExperiment]);

  const { data: sdkConnectionData } = useSDKConnections();
  const orgHasConnectedSDK =
    sdkConnectionData && sdkConnectionData.connections.some((c) => c.connected);
  const showSetUpFlow = canUseSetupFlow && !orgHasConnectedSDK;
  const agentOnboarding = useAgentOnboarding();

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
        title: msg`Feature Flag Analytics`,
        description: msg`View flag evaluations in real time`,
        docSection: "managedWarehouseTracking",
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
        <CreateExperimentModal
          onClose={() => setOpenNewExperimentModal(false)}
          source="home-page"
        />
      )}
      {openNewFeatureFlagModal && (
        <FeatureModal
          cta={t`Create`}
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

      <Box>
        {showMarketingBanner && <HomeMarketingBanner />}
        <Grid columns={`minmax(0, 1fr) ${DOCUMENTATION_SIDEBAR_WIDTH}`}>
          <Text size="7" weight="regular" mb="5" as="div">
            <Trans>Home</Trans>
          </Text>
          {orgHasConnectedSDK && (canCreateFeature || canCreateExperiment) && (
            <Flex justify={{ initial: "end", sm: "start" }} align="center">
              <DropdownMenu
                trigger={
                  <Button icon={<PiCaretDownFill />} iconPosition="right">
                    <Trans>Create</Trans>
                  </Button>
                }
              >
                {canCreateFeature && (
                  <DropdownMenuItem
                    onClick={() => {
                      setOpenNewFeatureFlagModal(true);
                    }}
                  >
                    <Trans>Feature Flag</Trans>
                  </DropdownMenuItem>
                )}
                {canCreateExperiment && (
                  <DropdownMenuItem
                    onClick={() => {
                      setOpenNewExperimentModal(true);
                    }}
                  >
                    <Trans>Experiment</Trans>
                  </DropdownMenuItem>
                )}
              </DropdownMenu>
            </Flex>
          )}
        </Grid>

        {!orgIsUsingFeatureOrExperiment && (
          <Text size="4" weight="medium" mb="3" as="div">
            <Trans>Get Started</Trans>
          </Text>
        )}
        <Grid
          columns={{
            // A wide table further down mustn't widen the stacked column
            // past the window.
            initial: "minmax(0, 1fr)",
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
                        <Trans>EXPLORE ADVANCED FEATURES</Trans>
                      </Text>
                    </Box>
                    <Flex direction={{ initial: "column", sm: "row" }} gap="4">
                      {advancedFeatures.map((feature) => (
                        <AdvancedFeaturesCard
                          key={feature.title.id}
                          {...feature}
                          title={i18n._(feature.title)}
                          description={i18n._(feature.description)}
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
                    <Trans>Get Started</Trans>
                  </Text>
                )}
                {orgIsUsingFeatureOrExperiment && (
                  <Button
                    variant="ghost"
                    onClick={() => setShowGettingStarted(!showGettingStarted)}
                  >
                    {showGettingStarted ? t`Hide Details` : t`Show Details`}
                  </Button>
                )}
              </Flex>
              <AutoRunCallout />
              {!showGettingStarted && (
                <Callout status="info" size="md">
                  <Text size="2">
                    <Trans>
                      Customize your account setup and learn how to get started
                      with GrowthBook.
                    </Trans>
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
                    {showDataScientistView ? (
                      <>
                        <SampleDataFeatureCard />
                        <SetUpDataSourceAndMetricsFeatureCard />
                      </>
                    ) : (
                      <>
                        <FeatureFlagFeatureCard />
                        <ExperimentFeatureCard />
                      </>
                    )}
                    <ImportFromOtherPlatformFeatureCard />
                    <AnalyzeExperimentFeatureCard />
                  </Grid>

                  <Separator my="5" size="4" />

                  {showSetUpFlow && (
                    <Callout status="wizard" size="md" mb="6">
                      <Trans>
                        Connect to your SDK to get started.{" "}
                        <Link
                          href={agentOnboarding ? "/connect" : "/setup"}
                          className="font-weight-bold"
                          style={{ color: "inherit" }}
                        >
                          Launch the setup flow
                        </Link>
                      </Trans>{" "}
                      <PiArrowSquareOut />
                    </Callout>
                  )}

                  {showDataScientistView && (
                    <Box mt="6" mb="2">
                      <Box mb="3">
                        <Text
                          size="1"
                          weight="medium"
                          style={{ color: "var(--color-text-mid)" }}
                        >
                          <Trans>EXPLORE FEATURES</Trans>
                        </Text>
                      </Box>
                      <Flex
                        direction={{ initial: "column", sm: "row" }}
                        gap="4"
                      >
                        {dataScientistFeatureList.map((feature) => (
                          <AdvancedFeaturesCard
                            key={feature.title.id}
                            {...feature}
                            title={i18n._(feature.title)}
                            description={i18n._(feature.description)}
                          />
                        ))}
                      </Flex>
                    </Box>
                  )}

                  {!showDataScientistView && (
                    <Box mb="6">
                      <Box mb="3">
                        <Text size="1" weight="bold">
                          <Trans>SET UP YOUR WORKSPACE</Trans>
                        </Text>
                      </Box>

                      <Card>
                        <Grid
                          columns={{ initial: "1fr", md: "1fr 1fr" }}
                          pb="2"
                        >
                          <WorkspaceLinks />
                        </Grid>
                      </Card>
                    </Box>
                  )}
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
      </Box>
    </>
  );
};

export default GetStartedAndHomePage;
