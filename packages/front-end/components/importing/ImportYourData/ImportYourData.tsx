import React, { FC, useState } from "react";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { Flex } from "@radix-ui/themes";
import track from "@/services/track";
import { ImportFromServiceCard } from "@/components/importing/ImportFromServiceCard/ImportFromServiceCard";
import { ImportRequestModal } from "@/components/importing/ImportRequestModal/ImportRequestModal";

type ImportYourDataProps = Record<string, never>;

const supportedServices = [
  {
    service: "LaunchDarkly",
    icon: "launchdarkly",
    hasDarkIcon: true,
    path: "launchdarkly",
    text: "Import your projects, features and environments from LaunchDarkly.",
  },
  {
    service: "Statsig",
    icon: "statsig",
    hasDarkIcon: false,
    path: "statsig",
    text: "Import your projects, features, environments, and metrics from Statsig.",
  },
];

// Behind a flag while it is being rolled out; the painted door stays otherwise
export const EPPO_IMPORTER_FLAG = "eppo-importer";
const eppoService = {
  service: "Eppo (Datadog)",
  icon: "eppo",
  hasDarkIcon: true,
  path: "eppo",
  text: "Import your Feature Flags, audiences, experiments, and warehouse-native metrics from Eppo.",
};

// Services we don't have a self-serve importer for yet. Clicking these opens a
// modal pointing at support so we can help with the migration (and gauge demand).
const upcomingServices = [
  {
    service: "Optimizely",
    slug: "optimizely",
    icon: "optimizely",
    hasDarkIcon: false,
    text: "Migrate your Feature Experimentation flags, audiences, and experiments.",
  },
  {
    service: "Eppo (Datadog)",
    slug: "eppo",
    icon: "eppo",
    hasDarkIcon: true,
    text: "Migrate your flags, audiences, experiments, and warehouse-native metrics.",
  },
  {
    service: "Split (Harness FME)",
    slug: "split",
    icon: "split",
    hasDarkIcon: false,
    text: "Migrate your feature flags, segments, and targeting rules.",
  },
  {
    service: "PostHog",
    slug: "posthog",
    icon: "posthog",
    hasDarkIcon: true,
    text: "Migrate your feature flags, cohorts, and experiments.",
  },
  {
    service: "Amplitude Experiment",
    slug: "amplitude",
    icon: "amplitude",
    hasDarkIcon: true,
    text: "Migrate your flags, targeting, and experiment designs.",
  },
  {
    service: "Unleash",
    slug: "unleash",
    icon: "unleash",
    hasDarkIcon: true,
    text: "Migrate your feature toggles, strategies, segments, and environments.",
  },
  {
    service: "Flagsmith",
    slug: "flagsmith",
    icon: "flagsmith",
    hasDarkIcon: false,
    text: "Migrate your flags, segments, and multivariate tests.",
  },
  {
    service: "ConfigCat",
    slug: "configcat",
    icon: "configcat",
    hasDarkIcon: false,
    text: "Migrate your settings, targeting rules, and percentage rollouts.",
  },
  {
    service: "Firebase Remote Config",
    slug: "firebase",
    icon: "firebase",
    hasDarkIcon: false,
    text: "Migrate your parameters, conditions, and A/B tests.",
  },
];

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
    <Flex direction="column" gap="3">
      {requestService && (
        <ImportRequestModal
          service={requestService.service}
          serviceSlug={requestService.slug}
          close={() => setRequestService(null)}
        />
      )}

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
    </Flex>
  );
};
