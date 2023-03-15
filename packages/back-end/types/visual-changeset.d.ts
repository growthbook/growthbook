interface DOMMutation {
  selector: string;
  action: "append" | "set" | "remove";
  attribute: string;
  value: string;
}

interface VisualChange {
  id: string;
  description: string;
  css: string;
  variation: string;
  domMutations: DOMMutation[];
}

export interface VisualChangesetInterface {
  id: string;
  organization: string;
  urlPatterns: string[];
  editorUrl: string;
  experiment: string;
  visualChanges: VisualChange[];
}
