import {
  $createAutoLinkNode,
  $isAutoLinkNode,
  AutoLinkNode,
  createLinkMatcherWithRegExp,
} from "@lexical/link";
import type { TextMatchTransformer } from "@lexical/markdown";
import { $createTextNode } from "lexical";

// Stops short of punctuation that usually ends the sentence around a URL.
const URL_PATTERN = /https?:\/\/[^\s<>"]*[^\s<>".,;:!?')\]]/;

/** Bare URLs become links as they're typed, pasted or loaded. */
export const URL_MATCHERS = [createLinkMatcherWithRegExp(URL_PATTERN)];

/**
 * A bare URL is saved as `<url>`, an autolink whose contents markdown leaves
 * alone. As plain text its underscores would be escaped, breaking the link.
 */
export const AUTO_LINK_TRANSFORMER: TextMatchTransformer = {
  dependencies: [AutoLinkNode],
  export: (node) => ($isAutoLinkNode(node) ? `<${node.getURL()}>` : null),
  importRegExp: /<(https?:\/\/[^\s<>]+)>/,
  regExp: /<(https?:\/\/[^\s<>]+)>$/,
  replace: (textNode, match) => {
    const url = match[1];
    const link = $createAutoLinkNode(url);
    link.append($createTextNode(url));
    textNode.replace(link);
  },
  trigger: ">",
  type: "text-match",
};
