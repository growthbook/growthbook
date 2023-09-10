import { ImportFromServiceCard } from "./ImportFromServiceCard";

export default {
  component: ImportFromServiceCard,
  title: "Importing/ImportFromServiceCard",
};

const supportedServices = [
  {
    service: "LaunchDarkly",
    icon: "launchdarkly",
    path: "launchdarkly",
    accentColor: "#000",
    text: "Import your projects, features and environments from LaunchDarkly.",
  },
  {
    service: "Split.io",
    icon: "split",
    path: "split",
    accentColor: "#fff",
    text: "Import your projects and features from Split.io.",
  },
  {
    service: "Unleash",
    icon: "unleash",
    path: "unleash",
    accentColor: "#EEF0F1",
    text: "Import your features from Unleash.",
  },
  {
    service: "Google Optimize",
    icon: "google-optimize",
    path: "google-optimize",
    accentColor: "#FFF",
    text: "Import your projects and experiments from Google Optimize.",
  },
  {
    service: "Optimizely",
    icon: "optimizely",
    path: "optimizely",
    accentColor: "#F0EFFD",
    text: "Import your features and projects from Optimizely.",
  },
  {
    service: "Statsig",
    icon: "statsig",
    path: "statsig",
    accentColor: "#F3F8FF",
    text: "Import your features and projects from Statsig.",
  },
  {
    service: "PostHog",
    icon: "posthog",
    path: "posthog",
    accentColor: "#EEEFEA",
    text: "Import your features from PostHog.",
  },
  {
    service: "Eppo",
    icon: "eppo",
    path: "eppo",
    accentColor: "#FCFBFF",
    text: "Import your experiments from Eppo.",
  },
];

export const Default = () => {
  return (
    <>
      {supportedServices.map(({ text, ...rest }) => (
        <div key={text} className="my-3">
          <ImportFromServiceCard {...rest}>{text}</ImportFromServiceCard>
        </div>
      ))}
    </>
  );
};
