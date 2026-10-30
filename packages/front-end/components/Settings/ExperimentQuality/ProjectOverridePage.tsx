import { Box, Flex } from "@radix-ui/themes";
import { PiArrowLeft } from "react-icons/pi";
import { date } from "shared/dates";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Switch from "@/ui/Switch";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import SettingsPage from "@/components/Layout/SettingsPage";
import { useAISettings } from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import QualityConfigEditor from "./QualityConfigEditor";
import QualitySaveFooter from "./QualitySaveFooter";
import { ChangedDot, DefaultHint } from "./ChangeMarkers";
import { useQualityScopeForm, useQualityStatus } from "./useQualityScopeForm";

const LIST_HREF = "/settings/experiment-quality#overrides";

export default function ProjectOverridePage({
  projectId,
  copyFrom,
}: {
  projectId: string;
  copyFrom: string | null;
}) {
  const permissionsUtil = usePermissionsUtil();
  const { aiEnabled } = useAISettings();
  const { getProjectById } = useDefinitions();
  const { status, hypothesisDefinition } = useQualityStatus();
  const form = useQualityScopeForm(projectId, copyFrom);
  const project = getProjectById(projectId);
  const name = project?.name ?? projectId;
  const copyName = copyFrom ? (getProjectById(copyFrom)?.name ?? copyFrom) : "";
  const count = status?.experimentsByProject?.[projectId] ?? 0;
  const experiments = `${count} experiment${count === 1 ? "" : "s"}`;
  const canEdit = permissionsUtil.canUpdateProject(projectId);

  if (!project) {
    return (
      <SettingsPage title="Experiment Quality">
        <Callout status="error">That Project couldn&apos;t be found.</Callout>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      title={name}
      parent={{ display: "Experiment Quality", href: LIST_HREF }}
      hideHeader
    >
      <Box mb="2">
        <Link href={LIST_HREF}>
          <Flex align="center" gap="1" display="inline-flex">
            <PiArrowLeft />
            Project overrides
          </Flex>
        </Link>
      </Box>
      <Flex justify="between" align="start" gap="4" mb="5">
        <Box>
          <Heading as="h1" size="xl" mb="1">
            {name}
          </Heading>
          <Text as="p" color="text-mid" mb="0">
            Based on{" "}
            <Text weight="semibold" color="text-high">
              {copyName && !form.record
                ? `a copy of ${copyName}`
                : "Organization default"}
            </Text>{" "}
            · {experiments}
            {form.record
              ? ` · Last edited ${date(form.record.dateUpdated)}`
              : ""}
          </Text>
        </Box>
        <Flex align="center" gap="2">
          {form.enabled !== form.orgEnabled ? <ChangedDot /> : null}
          <Switch
            label="Scoring on"
            value={form.enabled}
            disabled={!canEdit}
            onChange={form.setEnabled}
          />
          {form.enabled !== form.orgEnabled ? (
            <DefaultHint value={form.orgEnabled ? "on" : "off"} />
          ) : null}
        </Flex>
      </Flex>
      {!canEdit ? (
        <Callout status="info" mb="4">
          You don&apos;t have permission to change this Project&apos;s settings.
        </Callout>
      ) : null}
      <QualityConfigEditor
        draft={form.draft}
        setDraft={form.setDraft}
        base={form.orgDraft}
        aiAvailable={aiEnabled}
        decisionModelAvailable={!!status?.decisionModelAvailable}
        hypothesisDefinition={hypothesisDefinition}
        readOnly={!canEdit}
      />
      {canEdit ? (
        <QualitySaveFooter
          impact={
            <>
              Saving re-scores <strong>{experiments}</strong> in {name}.
            </>
          }
          scopeImpact={
            <>
              <strong>{experiments}</strong> in {name}
            </>
          }
          dirty={form.dirty}
          blocked={form.blocked}
          aiChanged={form.aiChanged}
          canRecheck={form.enabled && aiEnabled}
          save={form.save}
          cancel={form.cancel}
        />
      ) : null}
    </SettingsPage>
  );
}
