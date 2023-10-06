import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { getValidDate } from "shared/dates";
import { MemberData } from "@/hooks/useMembers";

export type FeatureDraftUiItem = {
  featureId: string;
  revisionId: string | null;
  dateCreated: Date;
  version: number;
  creatorUserId?: string;
  creator: {
    name: string;
    email: string;
  } | null;
};

const transformDraftForView = (members: Record<string, MemberData>) => (
  revision: FeatureRevisionInterface
): FeatureDraftUiItem => ({
  featureId: revision.featureId,
  revisionId: revision.id || null,
  dateCreated: getValidDate(revision.dateCreated, new Date(0)),
  version: revision.version,
  creatorUserId: revision.creatorUserId,
  creator:
    revision.creatorUserId && members[revision.creatorUserId]
      ? {
          name: members[revision.creatorUserId].display,
          email: members[revision.creatorUserId].email,
        }
      : null,
});

export const transformDraftsForView = (
  members: MemberData[],
  revisions: FeatureRevisionInterface[]
): FeatureDraftUiItem[] => {
  const memberLookup = memberLookupForMemberData(members);
  return revisions.map(transformDraftForView(memberLookup));
};

/**
 * ID to MemberData lookup from MemberData[]
 */
export const memberLookupForMemberData = (
  memberData: MemberData[]
): Record<string, MemberData> => {
  return memberData.reduce<Record<string, MemberData>>((acc, curr) => {
    acc[curr.id] = curr;
    return acc;
  }, {});
};
