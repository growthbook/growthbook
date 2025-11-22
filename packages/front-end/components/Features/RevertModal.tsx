import { FeatureInterface } from "back-end/types/feature";
import { useState, useMemo } from "react";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import isEqual from "lodash/isEqual";
import { filterEnvironmentsByFeature } from "shared/util";
import {
  getAffectedRevisionEnvs,
  getRules,
  useEnvironments,
} from "@/services/features";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
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

  const diffs = useMemo(() => {
    const diffs: { a: string; b: string; title: string }[] = [];

    if (revision.defaultValue !== feature.defaultValue) {
      diffs.push({
        title: "Default Value",
        a: feature.defaultValue,
        b: revision.defaultValue,
      });
    }
    environments.forEach((env) => {
      const liveRules = getRules(feature, env.id);
      const draftRules = revision.rules?.[env.id] || [];

      if (!isEqual(liveRules, draftRules)) {
        diffs.push({
          title: `Rules - ${env.id}`,
          a: JSON.stringify(liveRules, null, 2),
          b: JSON.stringify(draftRules, null, 2),
        });
      }
    });

    return diffs;
  }, [feature, revision, environments]);

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
