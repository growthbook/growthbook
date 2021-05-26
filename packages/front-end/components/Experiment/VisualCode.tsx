import { DomChange } from "back-end/types/experiment";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { tomorrow as theme } from "react-syntax-highlighter/dist/cjs/styles/prism";
import stringify from "json-stringify-pretty-compact";
import { useState } from "react";
import { FaCaretDown, FaCaretRight, FaCode } from "react-icons/fa";
import Link from "next/link";

export default function VisualCode({
  dom,
  css,
  control = false,
  experimentId,
}: {
  dom: DomChange[];
  css: string;
  control?: boolean;
  experimentId: string;
}) {
  const [open, setOpen] = useState(false);

  const hasCode = dom.length > 0 || css.length > 0;

  if (!hasCode) {
    return control ? null : (
      <div className="alert alert-warning my-2">
        No visual changes yet.{" "}
        <Link href={`/experiments/designer/${experimentId}`}>Open Editor</Link>
      </div>
    );
  }

  return (
    <div className="my-2">
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        <FaCode /> {open ? "hide code" : "show code"}
        {open ? <FaCaretDown /> : <FaCaretRight />}
      </a>
      {open && (
        <div style={{ marginTop: -8 }}>
          <SyntaxHighlighter language="json" style={theme}>
            {stringify(
              {
                mutations: dom.map((d) => [
                  d.selector,
                  d.action + " " + d.attribute,
                  d.value,
                ]),
                css: css || "",
              },
              {
                maxLength: 50,
              }
            )}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}
