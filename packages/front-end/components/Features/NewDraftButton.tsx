import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { isActiveDraftStatus } from "shared/validators";
import RevisionLabel from "@/components/Reviews/RevisionLabel";
import RevisionStatusBadge from "@/components/Reviews/RevisionStatusBadge";
import SharedNewDraftButton from "@/components/Reviews/NewDraftButton";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import Text from "@/ui/Text";

export default function NewDraftButton({
  feature,
  revisionList,
  mutate,
  setVersion,
}: {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  mutate: () => Promise<unknown> | void;
  setVersion: (version: number) => void;
}) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const live = revisionList.find((r) => r.version === feature.version);

  return (
    <SharedNewDraftButton
      entityNoun="Feature Flag"
      activeDraftCount={
        revisionList.filter((r) => isActiveDraftStatus(r.status)).length
      }
      maxDrafts={settings.maxConcurrentDrafts || 0}
      nextVersion={Math.max(0, ...revisionList.map((r) => r.version)) + 1}
      basedOn={
        <>
          <Text as="span" size="inherit" weight="semibold" color="text-high">
            <RevisionLabel
              version={feature.version}
              title={live?.title}
              // Untitled, it's already "Revision N".
              numbered={!!live?.title}
              minWidth={0}
              numberSize="inherit"
            />
          </Text>{" "}
          <RevisionStatusBadge revision={live} liveVersion={feature.version} />
        </>
      }
      create={async (draft) => {
        const res = await apiCall<{ draftVersion: number }>(
          `/feature/${feature.id}/draft`,
          { method: "POST", body: JSON.stringify(draft) },
        );
        await mutate();
        setVersion(res.draftVersion);
      }}
    />
  );
}
