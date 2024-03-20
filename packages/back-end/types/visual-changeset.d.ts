interface DOMMutation {
  selector: string;
  action: "append" | "set" | "remove";
  attribute: string;
  value?: string;
  parentSelector?: string;
  insertBeforeSelector?: string;
}

interface VisualChange {
  id: string;
  description: string;
  css: string;
  js?: string;
  variation: string;
  domMutations: DOMMutation[];
}

export interface VisualChangesetURLPattern {
  include: boolean;
  type: "simple" | "regex";
  pattern: string;
}

export interface VisualChangesetInterface {
  id: string;
  organization: string;
  urlPatterns: VisualChangesetURLPattern[];
  editorUrl: string;
  experiment: string;
  visualChanges: VisualChange[];
}
