import { FeatureInterface } from "shared/types/feature";
import { useState, useMemo } from "react";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { filterEnvironmentsByFeature } from "shared/util";
import { getAffectedRevisionEnvs, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import {
  useFeatureRevisionDiff,
  featureToFeatureRevisionDiffInput,
} from "@/hooks/useFeatureRevisionDiff";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { ExpandableDiff } from "./DraftModal";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import Text from "@/ui/Text";
import { Flex, Box } from "@radix-ui/themes";

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  /** Full list of all revisions — used to populate the target-version picker. */
  allRevisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

export default function RevertModal({
  feature,
  revision,
  allRevisions,
  close,
  mutate,
  setVersion,
}: Props) {
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const permissionsUtil = usePermissionsUtil();

  const { apiCall } = useAuth();

  // Previously-published revisions the user can revert to, newest-published
  // first. Computed before targetVersion state so the initial value can use
  // publishedRevisions[0] (most recently published before live).
  const publishedRevisions = useMemo(
    () =>
      allRevisions
        .filter(
          (r) => r.status === "published" && r.version !== feature.version,
        )
        .sort((a, b) => {
          const bt = b.datePublished ? new Date(b.datePublished).getTime() : 0;
          const at = a.datePublished ? new Date(a.datePublished).getTime() : 0;
          return bt - at;
        }),
    [allRevisions, feature.version],
  );

  const [targetVersion, setTargetVersion] = useState(
    () => publishedRevisions[0]?.version ?? revision.version,
  );
  const [comment, setComment] = useState(`Revert from #${feature.version}`);

  const targetRevision =
    allRevisions.find((r) => r.version === targetVersion) ?? revision;

  const diffs = useFeatureRevisionDiff({
    current: featureToFeatureRevisionDiffInput(feature),
    draft: targetRevision,
  });

  const hasPermission = permissionsUtil.canPublishFeature(
    feature,
    getAffectedRevisionEnvs(feature, targetRevision, environments),
  );

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      header={`Revert`}
      submit={
        hasPermission
          ? async () => {
              const res = await apiCall<{ version: number }>(
                `/feature/${feature.id}/${targetRevision.version}/revert`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    comment,
                  }),
                },
              );
              await mutate();
              res && res.version && setVersion(res.version);
            }
          : undefined
      }
      cta="Revert and Publish"
      close={close}
      closeCta="Cancel"
      size="max"
    >
      <h3>Review Changes</h3>
      <Flex align="center" gap="2" mb="3" wrap="wrap">
        <Text weight="medium">Reverting to:</Text>
        <Box style={{ flex: 1, minWidth: 200, maxWidth: 480 }}>
          <RevisionDropdown
            feature={feature}
            revisions={publishedRevisions}
            version={targetVersion}
            setVersion={setTargetVersion}
            variant="select"
            publishedOnly={true}
            menuPlacement="start"
          />
        </Box>
      </Flex>
      <p>
        The changes below will go live when you revert. Please review them
        carefully.
      </p>
      <div className="list-group mb-4">
        {diffs
          .filter((d) => d.a !== d.b)
          .map((diff) => (
            <ExpandableDiff {...diff} key={diff.title} />
          ))}
      </div>
      {hasPermission && (
        <Field
          label="Add a Comment (optional)"
          textarea
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
          }}
        />
      )}
    </Modal>
  );
}
