import { Box, Card, Flex, Heading, Text } from "@radix-ui/themes";
import Link from "next/link";
import {
  PiArrowFatLineRight,
  PiArrowRight,
  PiChartScatter,
} from "react-icons/pi";
import { useRouter } from "next/router";
import { ProjectInterface } from "back-end/types/project";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import track from "@/services/track";
import { AppFeatures } from "@/types/app-features";
import { useDefinitions } from "@/services/DefinitionsContext";
import { isCloud } from "@/services/env";
import styles from "./FeaturedCards.module.scss";

export function FeatureFlagFeatureCard({ title = "Create Feature Flags" }) {
  return (
    <CardLink href="/features">
      <Flex>
        <Heading as="h2" size="4" weight="bold">
          {title}
        </Heading>
        <ActionArrow />
      </Flex>

      <Text color="gray" mb="8">
        Explore a guided setup
      </Text>

      <Box mt="auto" mr="-9" className={styles.featureFlagImage} />
    </CardLink>
  );
}

export function ExperimentFeatureCard({ title = "Run an Experiment" }) {
  return (
    <CardLink href="/experiments">
      <Flex direction="column" height="100%">
        <Flex>
          <Heading as="h2" size="4" weight="bold">
            {title}
          </Heading>
          <ActionArrow />
        </Flex>

        <Text color="gray" mb="8">
          Explore a guided setup & sample results
        </Text>

        <Box mt="auto" mr="-9" className={styles.experimentImage} />
      </Flex>
    </CardLink>
  );
}

export function SampleDataFeatureCard({ title = "View a Sample Experiment" }) {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { projectId: demoDataSourceProjectId, demoExperimentId } =
    useDemoDataSourceProject();
  const gb = useGrowthBook<AppFeatures>();
  const { mutateDefinitions, setProject } = useDefinitions();

  const openSampleExperiment = async () => {
    if (demoDataSourceProjectId && demoExperimentId) {
      router.push(`/experiment/${demoExperimentId}`);
    } else {
      const res = await apiCall<{
        project: ProjectInterface;
        experimentId: string;
      }>(
        isCloud() && gb.isOn("new-sample-data")
          ? "/demo-datasource-project/new"
          : "/demo-datasource-project",
        {
          method: "POST",
        },
      );
      track("Create Sample Project", {
        source: "experiments-get-started",
      });
      await mutateDefinitions();
      if (demoDataSourceProjectId) {
        setProject(demoDataSourceProjectId);
      }
      if (res.experimentId) {
        router.push(`/experiment/${res.experimentId}`);
      } else {
        throw new Error("Could not create sample experiment");
      }
    }
  };

  return (
    <CardLink onClick={openSampleExperiment}>
      <Flex direction="column" height="100%">
        <Flex>
          <Heading as="h2" size="4" weight="bold">
            {title}
          </Heading>
          <ActionArrow />
        </Flex>

        <Text color="gray" mb="8">
          Explore a demo experiment with sample data
        </Text>

        <Box mt="auto" mr="-9" className={styles.experimentImage} />
      </Flex>
    </CardLink>
  );
}

export function SetUpDataSourceAndMetricsFeatureCard() {
  return (
    <CardLink href="/getstarted/data-source-guide">
      <Flex direction="column" height="100%">
        <Flex>
          <Heading as="h2" size="4" weight="bold">
            Set up Data Source & Metrics
          </Heading>
          <ActionArrow />
        </Flex>
        <Text color="gray" mb="8">
          Prepare to analyze experiment results
        </Text>
        {/* TODO: Replace with actual image once it's ready */}
        <Box mt="auto" ml="auto" mr="-7" className={styles.datasourceImage} />
      </Flex>
    </CardLink>
  );
}

export function ImportFromOtherPlatformFeatureCard() {
  const permissionsUtils = usePermissionsUtil();
  const canImportFromPlatform =
    permissionsUtils.canViewFeatureModal() &&
    permissionsUtils.canCreateEnvironment({
      projects: [],
      id: "",
    }) &&
    permissionsUtils.canCreateProjects();

  return (
    <Tooltip
      body={
        canImportFromPlatform
          ? ""
          : "You do not have permission to complete this action"
      }
      usePortal={true}
    >
      <CardLink
        href="/importing"
        disabled={!canImportFromPlatform}
        compact={true}
      >
        <Flex direction="row" align="center" justify="center" height="100%">
          <svg width="0" height="0">
            <linearGradient
              id="arrow-gradient"
              x1="100%"
              y1="100%"
              x2="0%"
              y2="0%"
            >
              <stop stopColor="#7B45EA" offset="0%" />
              <stop stopColor="#FFC53D" offset="100%" />
            </linearGradient>
          </svg>
          <PiArrowFatLineRight className={styles.migrateArrowIcon} />
          <Text ml="2" weight="bold" size="4">
            Migrate from another platform
          </Text>
          <ActionArrow />
        </Flex>
      </CardLink>
    </Tooltip>
  );
}

export function AnalyzeExperimentFeatureCard() {
  return (
    <CardLink href="/getstarted/imported-experiment-guide" compact={true}>
      <Flex direction="row" align="center" justify="center" height="100%">
        <svg width="0" height="0">
          <linearGradient
            id="chart-gradient"
            x1="100%"
            y1="100%"
            x2="0%"
            y2="0%"
          >
            <stop stopColor="#3E63DD" offset="0%" />
            <stop stopColor="#27B08B" offset="100%" />
          </linearGradient>
        </svg>
        <PiChartScatter className={styles.chartIcon} />
        <Text ml="2" weight="bold" size="4">
          Analyze Imported Experiments
        </Text>
        <ActionArrow />
      </Flex>
    </CardLink>
  );
}

// Internal components
function ActionArrow() {
  return (
    <Flex
      className={styles.actionArrow}
      flexShrink="0"
      align="center"
      justify="center"
      height="24px"
      width="24px"
    >
      <PiArrowRight />
    </Flex>
  );
}

type CardLinkProps = {
  children: React.ReactNode;
  style?: React.CSSProperties;
  disabled?: boolean;
  compact?: boolean;
} & ({ href: string; onClick?: never } | { href?: never; onClick: () => void });

function CardLink({
  children,
  href,
  onClick,
  style,
  disabled = false,
  compact = false,
}: CardLinkProps) {
  const padding = { initial: "2", xs: "3", sm: "2", md: "5" };

  const content = (
    <Flex
      direction="column"
      height="100%"
      px={padding}
      py={compact ? "1" : padding}
    >
      {children}
    </Flex>
  );

  return (
    <Card asChild>
      {href ? (
        <Link
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : undefined}
          className={styles.cardLink}
          style={style}
          href={href}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : undefined}
          className={styles.cardLink}
          style={style}
          onClick={onClick}
          disabled={disabled}
        >
          {content}
        </button>
      )}
    </Card>
  );
}
