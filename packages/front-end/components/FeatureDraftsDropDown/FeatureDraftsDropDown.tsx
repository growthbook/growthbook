import React, { FC } from "react";
import { ago, datetime } from "@/../shared/dates";
import { FeatureReviewRequest } from "back-end/types/feature-review";
import { FeatureDraftUiItem } from "@/components/FeatureDraftsDropDown/FeatureDraftsDropdown.utils";
import Avatar from "@/components/Avatar/Avatar";
import Dropdown from "@/components/Dropdown/Dropdown";

type FeatureDraftsListProps = {
  drafts: FeatureDraftUiItem[];
  onDraftClick: (draft: FeatureDraftUiItem) => void;
};

export const FeatureDraftsList: FC<FeatureDraftsListProps> = ({
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

type FeatureDraftsDropDownProps = {
  reviewRequests: FeatureReviewRequest[];
  drafts: FeatureDraftUiItem[];
  onDraftClick: (draft: FeatureDraftUiItem) => void;
};

export const FeatureDraftsDropDown: FC<FeatureDraftsDropDownProps> = ({
  reviewRequests,
  drafts,
  onDraftClick,
}) => {
  return (
    <div>
      <div className="d-flex justify-content-end">
        <Dropdown
          uuid="FeatureDraftsDropDown"
          caret
          width={600}
          toggle={
            <span
              title={`${reviewRequests.length} pending ${
                reviewRequests.length === 1 ? "review" : "reviews"
              }. ${drafts.length} ${
                drafts.length === 1 ? "draft" : "drafts"
              } in total.`}
            >
              <span className="font-weight-bold">Drafts</span>
              <span className="ml-1">
                {reviewRequests.length ? (
                  <span className="badge badge-danger">
                    {reviewRequests.length}
                  </span>
                ) : null}{" "}
                {drafts.length ? (
                  <span className="badge badge-gray">{drafts.length}</span>
                ) : null}
              </span>
            </span>
          }
        >
          <div className="p-4">
            <h3>Drafts</h3>
            <p>Drafts are unpublished versions of a feature.</p>

            {/* TODO: uncomment when we have support for approval flows */}
            {/*<h4>Ready for review</h4>*/}
            {/*<div className="mt-3">*/}
            {/*  <ul>*/}
            {/*    {reviewRequests.map((rr) => (*/}
            {/*      <li key={rr.id}>*/}
            {/*        from user {rr.userId} :{rr.description} -{" "}*/}
            {/*        {Object.keys(rr.reviews).length} review(s)*/}
            {/*      </li>*/}
            {/*    ))}*/}
            {/*  </ul>*/}
            {/*</div>*/}

            {/*<h4>Other drafts</h4>*/}
            <div className="mt-3">
              {drafts.length ? (
                <FeatureDraftsList
                  drafts={drafts}
                  onDraftClick={onDraftClick}
                />
              ) : (
                <p className="text-center">There are currently no drafts.</p>
              )}
            </div>
          </div>
        </Dropdown>
      </div>
    </div>
  );
};
