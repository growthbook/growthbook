import { CSSProperties, useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";

export default function ExpandableDiff({
  title,
  a,
  b,
  defaultOpen = false,
}: {
  title: string;
  a: string;
  b: string;
  defaultOpen?: boolean;
  styles?: Record<string, CSSProperties | Record<string, CSSProperties>>;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (a === b) return null;

  return (
    <div className="diff-wrapper">
      <div
        className="list-group-item list-group-item-action d-flex"
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        <div className="text-muted mr-2">Changed:</div>
        <strong>{title}</strong>
        <div className="ml-auto">
          {open ? <FaAngleDown /> : <FaAngleRight />}
        </div>
      </div>
      {open && (
        <div className="list-group-item list-group-item-light">
          <ReactDiffViewer
            oldValue={a}
            newValue={b}
            compareMethod={DiffMethod.LINES}
            styles={{
              contentText: {
                wordBreak: "break-all",
              },
            }}
          />
        </div>
      )}
    </div>
  );
}
