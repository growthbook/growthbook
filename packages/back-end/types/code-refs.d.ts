export interface FeatureCodeRefsInterface {
  organization: string;
  dateCreated: Date;
  dateUpdated: Date;
  feature: string;
  repo: string;
  branch: string;
  platform: "github" | "gitlab" | "bitbucket";
  refs: {
    filePath: string;
    startingLineNumber: number;
    lines: string;
    flagKey: string;
  }[];
}
