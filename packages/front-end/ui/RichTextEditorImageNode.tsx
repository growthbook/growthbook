import {
  DecoratorNode,
  DOMConversionMap,
  DOMExportOutput,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import { ReactNode } from "react";
import { TextMatchTransformer } from "@lexical/markdown";
import AuthorizedImage from "@/components/AuthorizedImage";
import styles from "./RichTextEditor.module.scss";

export type SerializedImageNode = Spread<
  { src: string; altText: string },
  SerializedLexicalNode
>;

/**
 * Images as a real node rather than raw markdown text, so an uploaded
 * screenshot shows up in the editor instead of a `![](url)` string.
 */
export class ImageNode extends DecoratorNode<ReactNode> {
  __src: string;
  __altText: string;

  static getType(): string {
    return "rich-text-image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__altText, node.__key);
  }

  constructor(src: string, altText: string, key?: NodeKey) {
    super(key);
    this.__src = src;
    this.__altText = altText;
  }

  static importJSON(serialized: SerializedImageNode): ImageNode {
    return new ImageNode(serialized.src, serialized.altText);
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      type: ImageNode.getType(),
      version: 1,
      src: this.__src,
      altText: this.__altText,
    };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: () => ({
        conversion: (element: HTMLElement) => ({
          node: new ImageNode(
            element.getAttribute("src") || "",
            element.getAttribute("alt") || "",
          ),
        }),
        priority: 0,
      }),
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("img");
    element.setAttribute("src", this.__src);
    element.setAttribute("alt", this.__altText);
    return { element };
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = styles.imageWrapper;
    return span;
  }

  updateDOM(): false {
    return false;
  }

  getSrc(): string {
    return this.__src;
  }

  getAltText(): string {
    return this.__altText;
  }

  decorate(): ReactNode {
    return (
      <AuthorizedImage
        src={this.__src}
        alt={this.__altText}
        className={styles.image}
      />
    );
  }
}

export function $createImageNode(src: string, altText: string): ImageNode {
  return new ImageNode(src, altText);
}

export function $isImageNode(node: LexicalNode | null): node is ImageNode {
  return node instanceof ImageNode;
}

/** `![alt](src)`, matched before the link transformer so links keep working. */
export const IMAGE_TRANSFORMER: TextMatchTransformer = {
  dependencies: [ImageNode],
  export: (node) => {
    if (!$isImageNode(node)) return null;
    return `![${node.getAltText()}](${node.getSrc()})`;
  },
  importRegExp: /!\[([^[]*)\]\(([^()\s]+)\)/,
  regExp: /!\[([^[]*)\]\(([^()\s]+)\)$/,
  replace: (textNode, match) => {
    const [, altText, src] = match;
    textNode.replace($createImageNode(src, altText));
  },
  trigger: ")",
  type: "text-match",
};
