import React, { FC, useCallback, useMemo, useState } from "react";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { FeatureInterface } from "back-end/types/feature";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useRouter } from "next/router";
import { ago, datetime } from "@/../shared/dates";
import useApi from "@/hooks/useApi";
import {
  FeatureDraftUiItem,
  transformDraftForView,
} from "@/components/FeatureDraftsDropDown/FeatureDraftsDropdown.utils";
import Avatar from "@/components/Avatar/Avatar";
import { gravatarForEmail } from "@/components/Avatar/Avatar.utils";
import useMembers, { MemberData } from "@/hooks/useMembers";

type FeatureDraftsDropDownProps = {
  drafts: FeatureDraftUiItem[];
  onDraftClick: (draft: FeatureDraftUiItem) => void;
};

export const FeatureDraftsDropDown: FC<FeatureDraftsDropDownProps> = ({
  drafts,
  onDraftClick,
}) => {
  return (
    <div className="">
      <table className="table table-hover">
        <thead>
          <tr>
            <th>Version</th>
            <th>Creator</th>
            <th>Created</th>
            <th>{/* Actions */}</th>
          </tr>
        </thead>

        <tbody>
          {drafts.map((draft, idx) => {
            const {
              creatorUserId,
              revisionId,
              version,
              dateCreated,
              creator,
            } = draft;
            return (
              <tr key={revisionId || `feat-rev-idx_${idx}`}>
                <td className="align-middle">{version}</td>
                <td className="align-middle">
                  <span className="mr-2">
                    <Avatar email={creator?.email || ""} size={30} />
                  </span>
                  {creator ? (
                    <span className="font-weight-bold nowrap">
                      {creator.name}
                    </span>
                  ) : creatorUserId ? (
                    <span className="font-italic nowrap">
                      (unknown user - <small>{creatorUserId}</small>)
                    </span>
                  ) : (
                    <span className="font-italic">(unknown user)</span>
                  )}
                </td>
                <td className="align-middle" title={datetime(dateCreated)}>
                  {ago(dateCreated)}
                </td>
                <td>
                  <button
                    onClick={() => onDraftClick(draft)}
                    className="btn btn-primary btn-sm"
                  >
                    View
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const FeatureDraftsDropDownContainer = () => {
  const router = useRouter();
  const { fid } = router.query;

  const { data, error } = useApi<{
    feature: FeatureInterface;
    experiments: { [key: string]: ExperimentInterfaceStringDates };
    revisions: FeatureRevisionInterface[];
    drafts: FeatureRevisionInterface[];
  }>(`/feature/${fid}`);

  const { memberUsernameOptions } = useMembers();

  const memberLookup = useMemo(
    (): Record<string, MemberData> =>
      memberUsernameOptions.reduce<Record<string, MemberData>>((acc, curr) => {
        acc[curr.id] = curr;
        return acc;
      }, {}),
    [memberUsernameOptions]
  );

  const onDraftClicked = useCallback((draft: FeatureDraftUiItem) => {
    console.log("draft clicked", draft);
  }, []);

  const revisions = useMemo(() => {
    if (!data) return [];

    return data.drafts.map(transformDraftForView(memberLookup));
  }, [data, memberLookup]);

  const drafts = revisions;

  if (error) {
    return <div className="alert alert-danger">Could not load drafts</div>;
  }

  return (
    <FeatureDraftsDropDown drafts={drafts} onDraftClick={onDraftClicked} />
  );
};
