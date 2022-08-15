import React, { useState } from "react";
import { FaChevronDown, FaChevronRight } from "react-icons/fa";

type Props = {
  title: string;
  open: boolean;
  children: JSX.Element;
  percentComplete?: number;
};

export function ExpandableDrawer({
  title,
  open,
  children,
  percentComplete,
}: Props) {
  const [isOpen, setIsOpen] = useState(open);

  return (
    <div
      className="container"
      style={{
        backgroundColor: "white",
        padding: "50px",
        margin: "10px",
        border: "1px solid rgba(0, 0, 0, 0.125)",
        borderRadius: "0.25rem",
        width: "auto",
      }}
    >
      <div className="row" role="button" onClick={() => setIsOpen(!isOpen)}>
        <div className="col-9">
          <h3 className="mb-0">{title}</h3>
        </div>
        <div
          className="col-2"
          style={{
            textAlign: "right",
          }}
        >
          {(percentComplete || percentComplete === 0) && (
            <span style={{ color: "#26A66B", fontWeight: "bold" }}>
              {`${percentComplete}% Complete`}
            </span>
          )}
        </div>
        <div
          className="col-1"
          style={{
            textAlign: "right",
          }}
        >
          {isOpen ? <FaChevronDown /> : <FaChevronRight />}
        </div>
      </div>
      {isOpen && children}
    </div>
  );
}
