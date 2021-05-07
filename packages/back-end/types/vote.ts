export type VoteDirType = 1 | -1;

export interface Vote {
  userId: string;
  dir: VoteDirType;
  dateCreated: Date;
  dateUpdated: Date;
}
