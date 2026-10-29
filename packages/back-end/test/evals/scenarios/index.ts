import type { Suite } from "back-end/test/evals/harness/scenario";
import { makeChangesSuite } from "./make-changes";
import { smokeSuite } from "./smoke";

export const SUITES: Suite[] = [smokeSuite, makeChangesSuite];
