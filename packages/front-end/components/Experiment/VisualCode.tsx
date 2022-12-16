import { DomChange } from "back-end/types/experiment";
import stringify from "json-stringify-pretty-compact";
import { useState } from "react";
import { FaCaretDown, FaCaretRight, FaCode } from "react-icons/fa";
import Link from "next/link";
import usePermissions from "@/hooks/usePermissions";
import Code from "../SyntaxHighlighting/Code";

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
  const permissions = usePermissions();

  const [open, setOpen] = useState(false);

  const hasCode = dom.length > 0 || css.length > 0;

  if (!hasCode && permissions.check("createAnalyses", "")) {
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
          <Code
            language="json"
            code={stringify(
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
          />
        </div>
      )}
    </div>
  );
}
