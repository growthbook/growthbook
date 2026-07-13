import { DetailedHTMLProps, FC, HTMLAttributes, useMemo } from "react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AuthorizedImage from "@/components/AuthorizedImage";
import MarkdownCodeBlock from "@/components/SyntaxHighlighting/MarkdownCodeBlock";
import styles from "./Markdown.module.scss";

const imageCache = {};

interface MarkdownProps
  extends DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
  isPublic?: boolean;
  shareUid?: string;
  shareType?: "experiment" | "report" | "dashboard";
  /**
   * When provided, relative (same-origin) links are handled by this callback
   * instead of opening in a new tab — e.g. to navigate in-app via the router.
   * External links (with a protocol) still open in a new tab.
   */
  onInternalLinkClick?: (href: string) => void;
  // Opt-in: syntax-highlight fenced code blocks (lazy-loaded Prism). Enabled
  // on the review surfaces (revision descriptions / comments); other markdown
  // surfaces keep plain code blocks.
  highlightCode?: boolean;
}

/** A relative, same-origin path like `/features/foo` — not protocol-relative. */
function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

const Markdown: FC<MarkdownProps> = ({
  children,
  className,
  isPublic = false,
  shareUid,
  shareType = "experiment",
  onInternalLinkClick,
  highlightCode = false,
  ...props
}) => {
  if (typeof children !== "string") {
    console.error(
      "The Markdown component expects a single string as child. Received",
      typeof children,
    );
  }

  const text = typeof children === "string" ? children : "";

  const components = useMemo(
    () => ({
      // Internal (relative) links navigate in-app when a handler is given;
      // everything else opens in a new tab.
      a: ({ ...props }) => {
        const href = props.href ?? "";
        if (onInternalLinkClick && isInternalHref(href)) {
          return (
            <a
              href={href}
              onClick={(e) => {
                // Let modifier-clicks (cmd/ctrl/middle) open a new tab as usual.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                onInternalLinkClick(href);
              }}
            >
              {props.children}
            </a>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {props.children}
          </a>
        );
      },
      img: ({ ...props }) => (
        <AuthorizedImage
          imageCache={imageCache}
          isPublic={isPublic}
          shareUid={shareUid}
          shareType={shareType}
          {...props}
        />
      ),
      ...(highlightCode
        ? {
            pre: ({ ...props }) => (
              <MarkdownCodeBlock>{props.children}</MarkdownCodeBlock>
            ),
          }
        : {}),
    }),
    [isPublic, shareUid, shareType, onInternalLinkClick, highlightCode],
  );

  return (
    <div {...props} className={clsx(className, styles.markdown)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => {
          // even though we're on 9.0.0, the URL sanitization in our version is
          // messing up & in urls. This code come from the latest version of react-markdown
          const safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i;
          const colon = url.indexOf(":");
          const questionMark = url.indexOf("?");
          const numberSign = url.indexOf("#");
          const slash = url.indexOf("/");

          if (
            // If there is no protocol, it’s relative.
            colon < 0 ||
            // If the first colon is after a `?`, `#`, or `/`, it’s not a protocol.
            (slash > -1 && colon > slash) ||
            (questionMark > -1 && colon > questionMark) ||
            (numberSign > -1 && colon > numberSign) ||
            // It is a protocol, it should be allowed.
            safeProtocol.test(url.slice(0, colon))
          ) {
            return url;
          }
          return "";
        }}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};
export default Markdown;
