export interface FeatureCodeRefsInterface {
  organization: string;
  dateUpdated: Date;
  feature: string;
  repo: string;
  branch: string;
  platform?: "github" | "gitlab" | "bitbucket";
  refs: {
    filePath: string;
    startingLineNumber: number;
    lines: string;
    flagKey: string;
  }[];
}
