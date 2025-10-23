import { DetailedHTMLProps, FC, HTMLAttributes, useMemo } from "react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AuthorizedImage from "@/components/AuthorizedImage";
import styles from "./Markdown.module.scss";

const imageCache = {};

interface MarkdownProps
  extends DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
  isPublic?: boolean;
  experimentUid?: string;
}

const Markdown: FC<MarkdownProps> = ({
  children,
  className,
  isPublic = false,
  experimentUid,
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
      // open external links in new tab
      a: ({ ...props }) => (
        <a href={props.href} target="_blank" rel="noreferrer">
          {props.children}
        </a>
      ),
      img: ({ ...props }) => (
        <AuthorizedImage
          imageCache={imageCache}
          isPublic={isPublic}
          experimentUid={experimentUid}
          {...props}
        />
      ),
    }),
    [isPublic, experimentUid],
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
