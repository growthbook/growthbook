export interface FeatureCodeRefsInterface {
  id: string;
  organization: string;
  dateCreated: Date;
  dateUpdated: Date;
  feature: string;
  repo: string;
  branch: string;
  platform: "github" | "gitlab" | "bitbucket";
  codeRefs: {
    filePath: string;
    startingLineNumber: number;
    lines: string;
    flagKey: string;
  }[];
}
