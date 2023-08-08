import React, { ReactNode } from "react";
import { FaAngleRight, FaExternalLinkAlt } from "react-icons/fa";
import Collapsible from "react-collapsible";
import { BsFlag } from "react-icons/bs";
import { FeatureInterface } from "back-end/types/feature";
import Link from "next/link";

type Props = {
  changeType: "flag" | "visual";
  feature?: FeatureInterface;
  page?: string;
  changes?: string[];
  open: boolean;
  children?: ReactNode;
};

export default function LinkedChange({
  changeType,
  feature,
  page,
  changes,
  open,
  children,
}: Props) {
  return (
    <div className="linked-change border bg-light my-3">
      <Collapsible
        trigger={
          <div className="px-3 py-3 row">
            <div className="col-auto d-flex align-items-center">
              <FaAngleRight className="chevron" />
            </div>
            {changeType === "flag" ? (
              <>
                <div className="col-auto d-flex align-items-center">
                  <BsFlag />
                  <code
                    className="ml-1 text-break"
                    style={{ color: "inherit" }}
                  >
                    {feature?.id || "Feature"}
                  </code>
                  <span className="badge badge-dark badge-pill ml-3">
                    {feature?.valueType}
                  </span>
                </div>
                <div className="col-auto ml-auto">
                  <Link href={`/features/${feature?.id}`} className="ml-4">
                    <a onClick={(e) => e.stopPropagation()}>
                      View Feature <FaExternalLinkAlt />
                    </a>
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="col-auto d-flex align-items-center">
                  <span className="text-muted hover-label">Page:</span>{" "}
                  <span className="ml-1 d-inline-block text-ellipsis hover-label">
                    {page}
                  </span>
                </div>
                <div className="col-auto ml-auto">
                  <span className="text-muted hover-label">Changes:</span>{" "}
                  <span className="hover-label">
                    {(changes?.length || 0) > 0 ? (
                      changes?.join(" + ")
                    ) : (
                      <em>none</em>
                    )}
                  </span>
                </div>
              </>
            )}
          </div>
        }
        open={open}
        transitionTime={100}
      >
        <div className="border-top mx-3 mb-3"></div>
        {children}
      </Collapsible>
    </div>
  );
}
