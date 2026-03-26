import { DetailedHTMLProps, FC, HTMLAttributes, useMemo } from "react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AuthorizedImage from "@/components/AuthorizedImage";
import { sanitizeUrl } from "@/services/urlSanitization";
import styles from "./Markdown.module.scss";

const imageCache = {};

interface MarkdownProps
  extends DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
  isPublic?: boolean;
  shareUid?: string;
  shareType?: "experiment" | "report";
}

const Markdown: FC<MarkdownProps> = ({
  children,
  className,
  isPublic = false,
  shareUid,
  shareType = "experiment",
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
          shareUid={shareUid}
          shareType={shareType}
          {...props}
        />
      ),
    }),
    [isPublic, shareUid, shareType],
  );

  return (
    <div {...props} className={clsx(className, styles.markdown)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={sanitizeUrl}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};
export default Markdown;
