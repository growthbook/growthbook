// 409 payload when a draft edit's baseline no longer matches.
export type DraftConflict<T> = {
  entityId: string;
  current: T | null;
  liveVersion: number;
  draftVersion?: number;
  merge?: {
    contested: Array<{ key: string; fields: string[] }>;
    theirFields: string[];
    yourFields: string[];
    wholeEntity?: boolean;
  };
};
