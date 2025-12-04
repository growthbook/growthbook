import { FeatureInterface } from "back-end/types/feature";
import { useState } from "react";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
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

export interface Props {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

export default function RevertModal({
  feature,
  revision,
  close,
  mutate,
  setVersion,
}: Props) {
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const permissionsUtil = usePermissionsUtil();

  const { apiCall } = useAuth();

  const [comment, setComment] = useState(
    revision.comment || `Revert from #${feature.version}`,
  );

  const diffs = useFeatureRevisionDiff({
    current: featureToFeatureRevisionDiffInput(feature),
    draft: revision,
  });

  const hasPermission = permissionsUtil.canPublishFeature(
    feature,
    getAffectedRevisionEnvs(feature, revision, environments),
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
                `/feature/${feature.id}/${revision.version}/revert`,
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
      <p>
        Reverting to <strong>Revision {revision.version}</strong>.
      </p>
      <p>
        The changes below will go live when you revert. Please review them
        carefully.
      </p>
      <div className="list-group mb-4">
        {diffs.map((diff) => (
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
