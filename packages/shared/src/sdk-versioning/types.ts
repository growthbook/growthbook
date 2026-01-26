export type SDKCapability =
  | "looseUnmarshalling"
  | "encryption"
  | "streaming"
  | "bucketingV2"
  | "visualEditor"
  | "semverTargeting"
  | "visualEditorJS"
  | "remoteEval"
  | "visualEditorDragDrop"
  | "stickyBucketing"
  | "redirects"
  | "prerequisites"
  | "savedGroupReferences"
  | "caseInsensitiveRegex";

export type CapabilityStrategy =
  | "min-ver-intersection" // intersection of capabilities using default SDK versions
  | "min-ver-intersection-loose-unmarshalling" // for generating SDK payloads. will interpret "looseUnmarshalling" as also supporting "bucketingV2", etc
  | "max-ver-intersection"; // intersection of capabilities using latest SDK versions
