import { ReactNode, useCallback, useState } from "react";
import { connectionServesAutoExperimentFeature } from "shared/util";
import type { AutoExperimentFeature } from "shared/types/organization";
import { Box } from "@radix-ui/themes";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Link from "@/ui/Link";
import useAutoExperiments, {
  AUTO_EXPERIMENTS_ENV_HINT,
} from "@/hooks/useAutoExperiments";
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
  const total = connections.length;
  const blocking = connections.filter(
    (c) => !connectionServesAutoExperimentFeature(c, feature),
  ).length;
  const { blocked } = AUTO_EXPERIMENT_COPY[feature];
  const summary =
    blocking === 0
      ? `No SDK Connections block ${blocked}.`
      : blocking < total
        ? `${blocking}/${total} SDK Connections block ${blocked}.`
        : total === 1
          ? `Your only SDK Connection blocks ${blocked}.`
          : `All ${total} SDK Connections block ${blocked}.`;
  return (
    // Spans: the dialog renders its content inside a paragraph.
    <Box as="span" display="block" mt="3">
      {summary}{" "}
      {/* A new tab: the dialog opens over forms with unsaved changes. */}
      <Link href="/sdks" external>
        View SDK Connections
      </Link>
    </Box>
  );
}

export default function EnableAutoExperimentDialog({
  feature,
  project,
  onEnabled,
  onConfirm,
  close,
}: {
  feature: AutoExperimentFeature;
  // Narrows the SDK Connection count to the ones that serve this Project.
  project?: string;
  onEnabled?: () => void;
  // Replaces saving the opt-in, for a form that saves it later.
  onConfirm?: () => void;
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
            ? `${AUTO_EXPERIMENTS_ENV_HINT}.`
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
        <>
          {copy.risk}
          <ConnectionCount feature={feature} project={project} />
        </>
      }
      yesText="Enable"
      onConfirm={async () => {
        if (onConfirm) onConfirm();
        else await setEnabled(feature, true);
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
