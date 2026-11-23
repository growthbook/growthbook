import { ReactNode, useCallback, useState } from "react";
import { connectionServesAutoExperimentFeature } from "shared/util";
import type { AutoExperimentFeature } from "shared/types/organization";
import { Flex } from "@radix-ui/themes";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import useAutoExperiments from "@/hooks/useAutoExperiments";
import useSDKConnections from "@/hooks/useSDKConnections";

export const AUTO_EXPERIMENT_COPY: Record<
  AutoExperimentFeature,
  { name: string; title: string; risk: string; blocked: string }
> = {
  visualEditor: {
    name: "AI Visual Editor experiments",
    title: "Enable AI Visual Editor experiments?",
    risk: "AI Visual Editor experiments change the content of your pages for visitors, without a code deploy. Anyone who can run experiments, or who gains access to such an account or API key, can change what your visitors see, including links and forms.",
    blocked: "AI Visual Editor changes",
  },
  urlRedirects: {
    name: "URL redirect experiments",
    title: "Enable URL redirect experiments?",
    risk: "URL redirect experiments send visitors from one of your pages to another, without a code deploy. Anyone who can run experiments, or who gains access to such an account or API key, can redirect your visitors.",
    blocked: "URL redirects",
  },
  customJs: {
    name: "Custom JavaScript",
    title: "Enable custom JavaScript?",
    risk: "Custom JavaScript in an AI Visual Editor experiment runs in your visitors' browsers with full access to the page. Anyone who can run experiments, or who gains access to such an account or API key, can run any code on your site.",
    blocked: "custom JavaScript",
  },
  crossOriginRedirects: {
    name: "Redirects to a different origin",
    title: "Enable redirects to a different origin?",
    risk: "A URL redirect experiment can then send visitors to another domain. Anyone who can run experiments, or who gains access to such an account or API key, can send your visitors to any website.",
    blocked: "redirects to a different origin",
  },
};

function ConnectionCount({
  feature,
  project,
}: {
  feature: AutoExperimentFeature;
  project?: string;
}) {
  const { data } = useSDKConnections();
  const connections = (data?.connections ?? []).filter(
    (c) =>
      !c.archived &&
      (!project || !c.projects.length || c.projects.includes(project)),
  );
  if (!connections.length) return null;
  const blocking = connections.filter(
    (c) => !connectionServesAutoExperimentFeature(c, feature),
  ).length;
  return (
    <Text as="div">
      {blocking}/{connections.length} SDK Connections block{" "}
      {AUTO_EXPERIMENT_COPY[feature].blocked}.{" "}
      <Link href="/sdks">View SDK Connections</Link>
    </Text>
  );
}

export default function EnableAutoExperimentDialog({
  feature,
  project,
  onEnabled,
  close,
}: {
  feature: AutoExperimentFeature;
  // Narrows the SDK Connection count to the ones that serve this Project.
  project?: string;
  onEnabled?: () => void;
  close: () => void;
}) {
  const { mode, canManage, setEnabled } = useAutoExperiments();
  const copy = AUTO_EXPERIMENT_COPY[feature];

  if (mode !== "allowed" || !canManage) {
    return (
      <ConfirmDialog
        title={`${copy.name} not enabled`}
        content={
          mode !== "allowed"
            ? "This GrowthBook instance does not allow enabling this. Set the ALLOW_AUTO_EXPERIMENTS environment variable to true to allow it."
            : "An admin must enable this for your organization."
        }
        yesText="Close"
        noText=""
        onConfirm={close}
        onCancel={close}
      />
    );
  }

  return (
    <ConfirmDialog
      title={copy.title}
      content={
        <Flex direction="column" gap="3">
          <Text as="div">{copy.risk}</Text>
          <ConnectionCount feature={feature} project={project} />
        </Flex>
      }
      yesText="Enable"
      onConfirm={async () => {
        await setEnabled(feature, true);
        close();
        onEnabled?.();
      }}
      onCancel={close}
    />
  );
}

// Runs an action only once its feature is enabled, asking first when it isn't.
export function useAutoExperimentGate(project?: string): {
  guard: (feature: AutoExperimentFeature, action: () => void) => void;
  dialog: ReactNode;
} {
  const { isEnabled } = useAutoExperiments();
  const [pending, setPending] = useState<{
    feature: AutoExperimentFeature;
    action: () => void;
  } | null>(null);
  const guard = useCallback(
    (feature: AutoExperimentFeature, action: () => void) =>
      isEnabled(feature) ? action() : setPending({ feature, action }),
    [isEnabled],
  );
  return {
    guard,
    dialog: pending ? (
      <EnableAutoExperimentDialog
        feature={pending.feature}
        project={project}
        onEnabled={pending.action}
        close={() => setPending(null)}
      />
    ) : null,
  };
}
