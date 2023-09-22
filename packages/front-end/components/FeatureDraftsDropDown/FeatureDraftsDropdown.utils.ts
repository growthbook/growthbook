import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { getValidDate } from "shared/dates";
import { MemberData } from "@/hooks/useMembers";

export type FeatureDraftUiItem = {
  revisionId: string | null;
  dateCreated: Date;
  version: number;
  creatorUserId?: string;
  creator: {
    name: string;
    email: string;
  } | null;
};

export const transformDraftForView = (members: Record<string, MemberData>) => (
  revision: FeatureRevisionInterface
): FeatureDraftUiItem => ({
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
