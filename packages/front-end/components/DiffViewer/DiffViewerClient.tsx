"use client";

import dynamic from "next/dynamic";
import { ComponentProps } from "react";
import type { DiffMethod as DiffMethodType } from "react-diff-viewer-continued";

// react-diff-viewer-continued uses a Web Worker (workerBundle) that doesn't exist
// or work in the Node.js SSR environment. We must load it only on the client.
const ReactDiffViewer = dynamic(
  () => import("react-diff-viewer-continued").then((mod) => mod.default),
  {
    ssr: false,
  },
);

// Match react-diff-viewer-continued's DiffMethod enum - type-only import avoids
// loading the package (and its worker) at module init
const DiffMethod = {
  CHARS: "diffChars" as DiffMethodType,
  WORDS: "diffWords" as DiffMethodType,
  WORDS_WITH_SPACE: "diffWordsWithSpace" as DiffMethodType,
  LINES: "diffLines" as DiffMethodType,
  TRIMMED_LINES: "diffTrimmedLines" as DiffMethodType,
  SENTENCES: "diffSentences" as DiffMethodType,
  CSS: "diffCss" as DiffMethodType,
  JSON: "diffJson" as DiffMethodType,
  YAML: "diffYaml" as DiffMethodType,
};

export { DiffMethod };

export type DiffViewerClientProps = Omit<
  ComponentProps<typeof ReactDiffViewer>,
  "oldValue" | "newValue"
> & {
  oldValue: string;
  newValue: string;
};

export default function DiffViewerClient(props: DiffViewerClientProps) {
  return <ReactDiffViewer {...props} />;
}
