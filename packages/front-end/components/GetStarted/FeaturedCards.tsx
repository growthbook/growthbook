import { Box, Card, Flex, Heading, Text } from "@radix-ui/themes";
import Link from "next/link";
import {
  PiArrowFatLineRight,
  PiArrowRight,
  PiChartScatter,
} from "react-icons/pi";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import styles from "./FeaturedCards.module.scss";

export function FeatureFlagFeatureCard() {
  return (
    <CardLink href="/getstarted/feature-flag-guide">
      <Flex>
        <Heading as="h2" size="4" weight="bold">
          Create Feature Flags from scratch
        </Heading>
        <ActionArrow />
      </Flex>

      <Text color="gray" mb="8">
        Explore a guided setup & sample feature flag
      </Text>

      <Box mt="auto" mr="-9" className={styles.featureFlagImage} />
    </CardLink>
  );
}

export function ExperimentFeatureCard() {
  return (
    <CardLink href="/getstarted/experiment-guide">
      <Flex direction="column" height="100%">
        <Flex>
          <Heading as="h2" size="4" weight="bold">
            Run an Experiment
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

export function LaunchDarklyImportFeatureCard() {
  const permissionsUtils = usePermissionsUtil();
  const canImportLaunchDarkly =
    permissionsUtils.canViewFeatureModal() &&
    permissionsUtils.canCreateEnvironment({
      projects: [],
      id: "",
    }) &&
    permissionsUtils.canCreateProjects();

  return (
    <Tooltip
      body={
        canImportLaunchDarkly
          ? ""
          : "You do not have permission to complete this action"
      }
    >
      <CardLink
        href="/importing/launchdarkly"
        disabled={!canImportLaunchDarkly}
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
            Migrate from LaunchDarkly
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

function CardLink({
  children,
  href,
  style,
  disabled = false,
  compact = false,
}: {
  children: React.ReactNode;
  href: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  compact?: boolean;
}) {
  const padding = { initial: "2", xs: "3", sm: "2", md: "5" };

  return (
    <Card asChild>
      <Link
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : undefined}
        className={styles.cardLink}
        style={style}
        href={href}
      >
        <Flex
          direction="column"
          height="100%"
          px={padding}
          py={compact ? "1" : padding}
        >
          {children}
        </Flex>
      </Link>
    </Card>
  );
}
