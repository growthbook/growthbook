import { Box } from "@radix-ui/themes";
import { countHealthOverrides } from "shared/enterprise";
import { ORG_DEFAULT_SCOPE } from "shared/validators";
import Callout from "@/ui/Callout";
import Switch from "@/ui/Switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import SettingsPage from "@/components/Layout/SettingsPage";
import { useAISettings } from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import QualityConfigEditor from "./QualityConfigEditor";
import QualitySaveFooter from "./QualitySaveFooter";
import ProjectOverridesTab from "./ProjectOverridesTab";
import { useQualityScopeForm, useQualityStatus } from "./useQualityScopeForm";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function ExperimentQualityPage() {
  const permissionsUtil = usePermissionsUtil();
  const canManageOrg = permissionsUtil.canManageOrgSettings();
  const { aiEnabled } = useAISettings();
  const { experimentationHealthSettings, getProjectById } = useDefinitions();
  const { status, hypothesisDefinition } = useQualityStatus();
  const form = useQualityScopeForm(ORG_DEFAULT_SCOPE);

  const overrides = experimentationHealthSettings.filter(
    (r) => r.project !== ORG_DEFAULT_SCOPE && countHealthOverrides(r) > 0,
  );
  // Projects with their own checks don't follow these
  const ownChecks = overrides.filter((r) => r.quality?.config);
  const counts = status?.experimentsByProject ?? {};
  const rescored =
    (status?.experiments ?? 0) -
    ownChecks.reduce((sum, r) => sum + (counts[r.project] ?? 0), 0);
  const ownNames = ownChecks.map(
    (r) => getProjectById(r.project)?.name ?? r.project,
  );
  const keepNote = ownNames.length
    ? ` ${
        ownNames.length > 3
          ? `${ownNames.slice(0, 3).join(", ")} and ${ownNames.length - 3} more`
          : ownNames.length > 1
            ? `${ownNames.slice(0, -1).join(", ")} and ${ownNames[ownNames.length - 1]}`
            : ownNames[0]
      } keep${ownNames.length === 1 ? "s its" : " their"} overrides.`
    : "";

  return (
    <SettingsPage
      title="Experiment Quality"
      description={
        <Box as="span" display="block" maxWidth="600px">
          Score every experiment 0–100 on how well it&apos;s documented and run.
          Projects use the organization default unless they override a section.
        </Box>
      }
      actions={
        <Switch
          label="Scoring on"
          value={form.enabled}
          disabled={!canManageOrg}
          onChange={form.setEnabled}
        />
      }
    >
      <Tabs defaultValue={canManageOrg ? "default" : "overrides"} persistInURL>
        <TabsList>
          <TabsTrigger value="default">Organization default</TabsTrigger>
          <TabsTrigger value="overrides">
            Project overrides ({overrides.length})
          </TabsTrigger>
        </TabsList>
        <Box pt="5">
          <TabsContent value="default">
            {!canManageOrg ? (
              <Callout status="info" mb="4">
                Only organization admins can change the organization default.
              </Callout>
            ) : null}
            <QualityConfigEditor
              draft={form.draft}
              setDraft={form.setDraft}
              aiAvailable={aiEnabled}
              decisionModelAvailable={!!status?.decisionModelAvailable}
              hypothesisDefinition={hypothesisDefinition}
              readOnly={!canManageOrg}
            />
          </TabsContent>
          <TabsContent value="overrides">
            <ProjectOverridesTab
              overrides={overrides}
              orgDraft={form.orgDraft}
              orgEnabled={form.orgEnabled}
              experimentsByProject={counts}
            />
          </TabsContent>
        </Box>
      </Tabs>
      {/* Below both tabs, since the switch above saves with it */}
      {canManageOrg ? (
        <QualitySaveFooter
          impact={
            <>
              Saving re-scores <strong>{plural(rescored, "experiment")}</strong>
              .{keepNote}
            </>
          }
          scopeImpact={<strong>{plural(rescored, "experiment")}</strong>}
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
