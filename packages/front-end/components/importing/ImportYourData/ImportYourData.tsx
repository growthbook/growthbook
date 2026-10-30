import React, { FC, ReactNode, useState } from "react";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { Box, Flex } from "@radix-ui/themes";
import { PiQuestion } from "react-icons/pi";
import track from "@/services/track";
import { ImportFromServiceCard } from "@/components/importing/ImportFromServiceCard/ImportFromServiceCard";
import { ImportRequestModal } from "@/components/importing/ImportRequestModal/ImportRequestModal";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import styles from "./ImportYourData.module.scss";

type ImportYourDataProps = Record<string, never>;

const SUPPORT_EMAIL = "support@growthbook.io";

const supportedServices = [
  {
    service: "LaunchDarkly",
    icon: "launchdarkly",
    hasDarkIcon: true,
    path: "launchdarkly",
    text: "Connect with a LaunchDarkly API access token.",
  },
  {
    service: "Statsig",
    icon: "statsig",
    hasDarkIcon: false,
    path: "statsig",
    text: "Connect with a Statsig Console API key.",
  },
];

// Behind a flag while it is being rolled out; the painted door stays otherwise
export const EPPO_IMPORTER_FLAG = "eppo-importer";
const eppoService = {
  service: "Eppo (Datadog)",
  icon: "eppo",
  hasDarkIcon: true,
  path: "eppo",
  text: "Connect with an Eppo API key. Metrics stay warehouse-native.",
};

// Services we don't have a self-serve importer for yet. Each opens a modal
// pointing at support so we can help with the migration (and gauge demand).
const upcomingServices = [
  {
    service: "Optimizely",
    slug: "optimizely",
    icon: "optimizely",
    hasDarkIcon: false,
    text: "Feature Experimentation flags, audiences, and experiments.",
  },
  {
    service: "Eppo (Datadog)",
    slug: "eppo",
    icon: "eppo",
    hasDarkIcon: true,
    text: "Flags, audiences, experiments, and warehouse-native metrics.",
  },
  {
    service: "Split (Harness FME)",
    slug: "split",
    icon: "split",
    hasDarkIcon: false,
    text: "Feature flags, segments, and targeting rules.",
  },
  {
    service: "PostHog",
    slug: "posthog",
    icon: "posthog",
    hasDarkIcon: true,
    text: "Feature flags, cohorts, and experiments.",
  },
  {
    service: "Amplitude Experiment",
    slug: "amplitude",
    icon: "amplitude",
    hasDarkIcon: true,
    text: "Flags, targeting, and experiment designs.",
  },
  {
    service: "Unleash",
    slug: "unleash",
    icon: "unleash",
    hasDarkIcon: true,
    text: "Feature toggles, strategies, segments, and environments.",
  },
  {
    service: "Flagsmith",
    slug: "flagsmith",
    icon: "flagsmith",
    hasDarkIcon: false,
    text: "Flags, segments, and multivariate tests.",
  },
  {
    service: "ConfigCat",
    slug: "configcat",
    icon: "configcat",
    hasDarkIcon: false,
    text: "Settings, targeting rules, and percentage rollouts.",
  },
  {
    service: "Firebase Remote Config",
    slug: "firebase",
    icon: "firebase",
    hasDarkIcon: false,
    text: "Parameters, conditions, and A/B tests.",
  },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Box>
      <Heading as="h2" size="md" mb="1">
        {title}
      </Heading>
      <Text as="p" color="text-mid" mb="3">
        {description}
      </Text>
      <Frame mb="0" py="0" px="0" className={styles.list}>
        {children}
      </Frame>
    </Box>
  );
}

export const ImportYourData: FC<ImportYourDataProps> = (_props) => {
  const [requestService, setRequestService] = useState<null | {
    service: string;
    slug: string;
  }>(null);
  const eppoImporter = useFeatureIsOn(EPPO_IMPORTER_FLAG);
  const supported = eppoImporter
    ? [...supportedServices, eppoService]
    : supportedServices;
  const upcoming = eppoImporter
    ? upcomingServices.filter((s) => s.slug !== "eppo")
    : upcomingServices;

  return (
    <Flex direction="column" gap="6">
      {requestService && (
        <ImportRequestModal
          service={requestService.service}
          serviceSlug={requestService.slug}
          close={() => setRequestService(null)}
        />
      )}

      <Section
        title="Import Directly"
        description="Run the importer here. You review what will be created before anything is saved."
      >
        {supported.map(({ service, icon, path, hasDarkIcon, text }) => (
          <ImportFromServiceCard
            key={`ImportFromServiceCard-${service}`}
            service={service}
            icon={icon}
            path={path}
            hasDarkIcon={hasDarkIcon}
          >
            {text}
          </ImportFromServiceCard>
        ))}
      </Section>

      <Section
        title="Migrate With Help"
        description="No importer yet. Ask our team to help plan your migration."
      >
        {upcoming.map(({ service, slug, icon, hasDarkIcon, text }) => (
          <ImportFromServiceCard
            key={`ImportFromServiceCard-${service}`}
            service={service}
            icon={icon}
            hasDarkIcon={hasDarkIcon}
            onRequest={() => {
              track("Import interest clicked", { service: slug });
              setRequestService({ service, slug });
            }}
          >
            {text}
          </ImportFromServiceCard>
        ))}
      </Section>

      <Flex align="center" gap="4" px="4" py="4" className={styles.requestBox}>
        <PiQuestion size={22} style={{ color: "var(--color-text-mid)" }} />
        <Box flexGrow="1">
          <Heading as="h3" size="sm" mb="1">
            Don&apos;t See Your Tool?
          </Heading>
          <Text as="p" color="text-mid" m="0">
            Tell us what you use and we&apos;ll help you plan the move.
          </Text>
        </Box>
        <Flex gap="4" flexShrink="0">
          <Link
            onClick={() => {
              track("Import interest clicked", { service: "other" });
              setRequestService({ service: "another tool", slug: "other" });
            }}
          >
            Request an integration
          </Link>
          <Link href={`mailto:${SUPPORT_EMAIL}`}>Contact support</Link>
        </Flex>
      </Flex>
    </Flex>
  );
};
