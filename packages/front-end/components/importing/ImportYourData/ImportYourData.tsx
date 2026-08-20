import React, { FC, useState } from "react";
import track from "@/services/track";
import { ImportFromServiceCard } from "@/components/importing/ImportFromServiceCard/ImportFromServiceCard";
import { ImportRequestModal } from "@/components/importing/ImportRequestModal/ImportRequestModal";

type ImportYourDataProps = Record<string, never>;

const supportedServices = [
  {
    service: "LaunchDarkly",
    icon: "launchdarkly",
    path: "launchdarkly",
    accentColor: "#000",
    text: "Import your projects, features and environments from LaunchDarkly.",
  },
  {
    service: "Statsig",
    icon: "statsig",
    path: "statsig",
    accentColor: "#000",
    text: "Import your projects, features, environments, and metrics from Statsig.",
  },
];

// Services we don't have a self-serve importer for yet. Clicking these opens a
// modal pointing at support so we can help with the migration (and gauge demand).
const upcomingServices = [
  {
    service: "Optimizely",
    slug: "optimizely",
    icon: "optimizely",
    accentColor: "#000",
    text: "Migrate your Feature Experimentation flags, audiences, and experiments.",
  },
  {
    service: "Eppo (Datadog)",
    slug: "eppo",
    icon: "eppo",
    accentColor: "#000",
    text: "Migrate your flags, audiences, experiments, and warehouse-native metrics.",
  },
  {
    service: "Split (Harness FME)",
    slug: "split",
    icon: "split",
    accentColor: "#000",
    text: "Migrate your feature flags, segments, and targeting rules.",
  },
  {
    service: "PostHog",
    slug: "posthog",
    icon: "posthog",
    accentColor: "#000",
    text: "Migrate your feature flags, cohorts, and experiments.",
  },
  {
    service: "Amplitude Experiment",
    slug: "amplitude",
    icon: "amplitude",
    accentColor: "#000",
    text: "Migrate your flags, targeting, and experiment designs.",
  },
  {
    service: "Unleash",
    slug: "unleash",
    icon: "unleash",
    accentColor: "#000",
    text: "Migrate your feature toggles, strategies, segments, and environments.",
  },
  {
    service: "Flagsmith",
    slug: "flagsmith",
    icon: "flagsmith",
    accentColor: "#000",
    text: "Migrate your flags, segments, and multivariate tests.",
  },
  {
    service: "ConfigCat",
    slug: "configcat",
    icon: "configcat",
    accentColor: "#000",
    text: "Migrate your settings, targeting rules, and percentage rollouts.",
  },
  {
    service: "VWO",
    slug: "vwo",
    icon: "vwo",
    accentColor: "#000",
    text: "Migrate your feature flags and experiments.",
  },
  {
    service: "Firebase Remote Config",
    slug: "firebase",
    icon: "firebase",
    accentColor: "#000",
    text: "Migrate your parameters, conditions, and A/B tests.",
  },
];

export const ImportYourData: FC<ImportYourDataProps> = (_props) => {
  const [requestService, setRequestService] = useState<null | {
    service: string;
    slug: string;
  }>(null);

  return (
    <div>
      {requestService && (
        <ImportRequestModal
          service={requestService.service}
          serviceSlug={requestService.slug}
          close={() => setRequestService(null)}
        />
      )}

      <h1>Import your data</h1>

      {supportedServices.map(({ service, icon, path, accentColor, text }) => (
        <div key={`ImportFromServiceCard-${service}`} className="my-3">
          <ImportFromServiceCard
            service={service}
            icon={icon}
            path={path}
            accentColor={accentColor}
          >
            {text}
          </ImportFromServiceCard>
        </div>
      ))}

      <h2 className="mt-5">Migrating from somewhere else?</h2>
      <p>
        We can help you move from these platforms too. Let us know what you need
        &mdash; it also helps us decide which importers to build next.
      </p>

      {upcomingServices.map(({ service, slug, icon, accentColor, text }) => (
        <div key={`ImportFromServiceCard-${service}`} className="my-3">
          <ImportFromServiceCard
            service={service}
            icon={icon}
            accentColor={accentColor}
            onRequest={() => {
              track("Import interest clicked", { service: slug });
              setRequestService({ service, slug });
            }}
          >
            {text}
          </ImportFromServiceCard>
        </div>
      ))}
    </div>
  );
};
