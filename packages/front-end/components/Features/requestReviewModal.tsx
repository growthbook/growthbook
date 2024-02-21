import { FeatureInterface } from "back-end/types/feature";
import { useState, useMemo, ChangeEvent, useRef } from "react";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { autoMerge, mergeResultHasChanges } from "shared/util";
import {
  Callout,
  Flex,
  RadioGroup,
  TextArea,
  Text,
  Checkbox,
  Heading,
} from "@radix-ui/themes";
import { useForm } from "react-hook-form";
import { ReviewSubmittedType } from "@/../back-end/src/models/FeatureRevisionModel";

import { EventAuditUserLoggedIn } from "back-end/src/events/event-types";
import { getAffectedRevisionEnvs, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import { getCurrentUser } from "@/services/UserContext";
import Modal from "../Modal";
import Field from "../Forms/Field";
import LegacyButton from "../Button";
import { ExpandableDiff } from "./DraftModal";
import Revisionlog from "./RevisionLog";
export interface Props {
  feature: FeatureInterface;
  version: number;
  revisions: FeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  onPublish?: () => void;
  onDiscard?: () => void;
}

export default function RequestReviewModal({
  feature,
  version,
  revisions,
  close,
  mutate,
  onDiscard,
}: Props) {
  const environments = useEnvironments();
  const [showSubmitReview, setShowSumbmitReview] = useState(false);
  const [adminPublish, setAdminPublish] = useState(false);
  const { apiCall } = useAuth();
  const user = getCurrentUser();
  const permissions = usePermissions();

  const commentRef = useRef<HTMLInputElement>(null);
  const scrollToComment = () => {
    commentRef?.current?.scrollIntoView();
  };
  const canPublish = permissions.check("bypassApprovalChecks");
  const revision = revisions.find((r) => r.version === version);
  const isPendingReview =
    revision?.status === "pending-review" ||
    revision?.status === "changes-requested";
  const createdBy = revision?.createdBy as EventAuditUserLoggedIn;
  const canReview =
    isPendingReview &&
    createdBy?.id !== user?.id &&
    permissions.check("canReview");
  const approved = revision?.status === "approved" || adminPublish;
  const baseRevision = revisions.find(
    (r) => r.version === revision?.baseVersion
  );
  const liveRevision = revisions.find((r) => r.version === feature.version);

  const mergeResult = useMemo(() => {
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevision,
      baseRevision,
      revision,
      environments.map((e) => e.id),
      {}
    );
  }, [revision, baseRevision, liveRevision, environments]);

  const [comment, setComment] = useState("");
  const submitReviewform = useForm<{
    reviewStatus: ReviewSubmittedType;
    comment: string;
  }>({
    defaultValues: {
      reviewStatus: "Comment",
    },
  });
  const submitButton = async () => {
    if (!isPendingReview && !approved) {
      try {
        await apiCall(`/feature/${feature.id}/${revision?.version}/request`, {
          method: "POST",
          body: JSON.stringify({
            mergeResultSerialized: JSON.stringify(mergeResult),
            comment,
          }),
        });
      } catch (e) {
        mutate();
        throw e;
      }
      await mutate();
    } else if (canReview) {
      setShowSumbmitReview(true);
    } else if (approved) {
      try {
        await apiCall(`/feature/${feature.id}/${revision?.version}/publish`, {
          method: "POST",
          body: JSON.stringify({
            mergeResultSerialized: JSON.stringify(mergeResult),
            comment,
            adminOverride: adminPublish,
          }),
        });
      } catch (e) {
        mutate();
        throw e;
      }
      await mutate();
    }
  };

  const resultDiffs = useMemo(() => {
    const diffs: { a: string; b: string; title: string }[] = [];

    if (!mergeResult) return diffs;
    if (!mergeResult.success) return diffs;

    const result = mergeResult.result;

    if (result.defaultValue !== undefined) {
      diffs.push({
        title: "Default Value",
        a: feature.defaultValue,
        b: result.defaultValue,
      });
    }
    if (result.rules) {
      environments.forEach((env) => {
        const liveRules = feature.environmentSettings?.[env.id]?.rules || [];
        if (result.rules && result.rules[env.id]) {
          diffs.push({
            title: `Rules - ${env.id}`,
            a: JSON.stringify(liveRules, null, 2),
            b: JSON.stringify(result.rules[env.id], null, 2),
          });
        }
      });
    }

    return diffs;
  }, [
    environments,
    feature.defaultValue,
    feature.environmentSettings,
    mergeResult,
  ]);

  if (!revision || !mergeResult) return null;

  const hasPermission = permissions.check(
    "publishFeatures",
    feature.project,
    getAffectedRevisionEnvs(feature, revision, environments)
  );

  const hasChanges = mergeResultHasChanges(mergeResult);
  let ctaCopy = "Request Review";
  if (approved) {
    ctaCopy = "Publish";
  } else if (canReview) {
    ctaCopy = "Next";
  }
  const renderRequestAndViewModal = () => {
    return (
      <Modal
        open={true}
        header={"Review Draft Changes"}
        cta={ctaCopy}
        close={close}
        autoCloseOnSubmit={canReview ? false : true}
        closeCta="Cancel"
        size="lg"
        submit={
          !isPendingReview || canReview || approved ? submitButton : undefined
        }
        secondaryCTA={
          isPendingReview && !canReview ? (
            <LegacyButton
              color="danger"
              onClick={async () => {
                try {
                  await apiCall(
                    `/feature/${feature.id}/${revision.version}/discard`,
                    {
                      method: "POST",
                    }
                  );
                } catch (e) {
                  await mutate();
                  throw e;
                }
                await mutate();
                onDiscard && onDiscard();
                close();
              }}
            >
              Discard
            </LegacyButton>
          ) : undefined
        }
      >
        {mergeResult.conflicts.length > 0 && (
          <div className="alert alert-danger">
            <strong>Conflicts Detected</strong>. Please fix conflicts before
            publishing this draft.
          </div>
        )}

        {!hasChanges && !mergeResult.conflicts.length && (
          <div className="alert alert-info">
            There are no changes to publish. Either discard the draft or add
            changes first before publishing.
          </div>
        )}

        {mergeResult.success && hasChanges && (
          <div>
            <Callout.Root color={isPendingReview ? "amber" : "gray"}>
              <Callout.Text>
                Publishing to the prod environment requires approval.
              </Callout.Text>
            </Callout.Root>
            {canPublish && (
              <Text as="label" size="2" className="mt-3">
                <Flex gap="2">
                  <Checkbox
                    checked={adminPublish}
                    onCheckedChange={(checkedState) => {
                      checkedState === "indeterminate"
                        ? setAdminPublish(false)
                        : setAdminPublish(checkedState);
                    }}
                  />
                  Bypass approval requirement to publish (optional for Admins
                  only)
                </Flex>
              </Text>
            )}
            <div className="text-right">
              <div
                onClick={scrollToComment}
                style={{ cursor: "pointer" }}
                className="text-purple"
              >
                Leave a comment
              </div>
            </div>
            <div className="list-group mb-4 mt-4">
              <Heading size="4" mb="3">
                Diffs by Enviroment
              </Heading>
              {resultDiffs.map((diff) => (
                <ExpandableDiff {...diff} key={diff.title} />
              ))}
            </div>
            <Heading size="4" mb="3">
              Change Request Log
            </Heading>

            <Revisionlog
              feature={feature}
              revision={revision}
              commentsOnly={true}
            />
            {hasPermission && !canReview && (
              <div className="mt-3" id="comment-section">
                <Field
                  label="Add a Comment (optional)"
                  textarea
                  placeholder="Summary of changes..."
                  value={comment}
                  ref={commentRef}
                  onChange={(e) => {
                    setComment(e.target.value);
                  }}
                />
                {!canReview && isPendingReview && (
                  <LegacyButton
                    onClick={async () => {
                      try {
                        await apiCall(
                          `/feature/${feature.id}/${revision.version}/comment`,
                          {
                            method: "POST",
                            body: JSON.stringify({
                              comment,
                            }),
                          }
                        );
                      } catch (e) {
                        await mutate();
                        throw e;
                      }
                      setComment("");
                      await mutate();
                      close();
                    }}
                  >
                    Comment
                  </LegacyButton>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    );
  };

  const renderReviewAndSubmitModal = () => {
    return (
      <Modal
        open={true}
        close={close}
        header={"Review Draft Changes"}
        cta={"Submit"}
        size="lg"
        includeCloseCta={false}
        submit={submitReviewform.handleSubmit(async (data) => {
          try {
            await apiCall(
              `/feature/${feature.id}/${revision?.version}/submit-review`,
              {
                method: "POST",
                body: JSON.stringify({
                  comment: data.comment,
                  review: data.reviewStatus,
                }),
              }
            );
          } catch (e) {
            mutate();
            throw e;
          }
          await mutate();
        })}
        secondaryCTA={
          <LegacyButton
            color="outline"
            onClick={async () => setShowSumbmitReview(false)}
          >
            Back
          </LegacyButton>
        }
      >
        <div style={{ padding: "0 30px" }}>
          <Text weight="bold">
            Leave a Comment
            <TextArea
              placeholder="leave a comment"
              mb="5"
              mt="3"
              {...submitReviewform.register("comment")}
            />
          </Text>
          <RadioGroup.Root
            defaultValue="Comment"
            size="2"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              if (e.target.checked) {
                submitReviewform.setValue(
                  "reviewStatus",
                  e.target.value as ReviewSubmittedType
                );
              }
            }}
          >
            <Flex gap="2" direction="column">
              <Flex gap="2">
                <RadioGroup.Item value="Comment" />
                <div>
                  <Text as="div" size="2" weight="bold">
                    Comment
                  </Text>
                  <Text as="div" size="2">
                    Submit general feedback without explicit approval.
                  </Text>
                </div>
              </Flex>
              <Flex gap="2">
                <RadioGroup.Item value="Requested Changes" />
                <div>
                  <Text as="div" size="2" weight="bold">
                    Request Changes
                  </Text>
                  <Text as="div" size="2">
                    Submit feedback that must be addressed before publishing.
                  </Text>
                </div>
              </Flex>
              <Flex gap="2">
                <RadioGroup.Item value="Approved" />
                <div>
                  <Text as="div" size="2" weight="bold">
                    Approve
                  </Text>
                  <Text as="div" size="2">
                    Submit feedback and approve for publishing.
                  </Text>
                </div>
              </Flex>
            </Flex>
          </RadioGroup.Root>
        </div>
      </Modal>
    );
  };

  return showSubmitReview
    ? renderReviewAndSubmitModal()
    : renderRequestAndViewModal();
}
