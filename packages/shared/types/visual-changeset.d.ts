import { z } from "zod";
import {
  domMutationValidator,
  visualChangesetUrlPatternValidator,
} from "shared/validators";

export type DOMMutation = z.infer<typeof domMutationValidator>;

interface VisualChange {
  id: string;
  description: string;
  css: string;
  js?: string;
  variation: string;
  domMutations: DOMMutation[];
}

export type VisualChangesetURLPattern = z.infer<
  typeof visualChangesetUrlPatternValidator
>;

export interface VisualChangesetInterface {
  id: string;
  organization: string;
  urlPatterns: VisualChangesetURLPattern[];
  editorUrl: string;
  experiment: string;
  visualChanges: VisualChange[];
}
