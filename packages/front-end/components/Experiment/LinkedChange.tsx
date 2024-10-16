import React, { ReactNode } from "react";
import { FaAngleRight, FaExternalLinkAlt } from "react-icons/fa";
import Collapsible from "react-collapsible";
import { BsFlag } from "react-icons/bs";
import { FeatureValueType } from "back-end/types/feature";
import Link from "next/link";

type Props = {
  changeType: "flag" | "visual";
  feature?: { id: string; valueType: FeatureValueType };
  additionalBadge?: ReactNode;
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
  additionalBadge,
  open,
  children,
}: Props) {
  return (
    <div className="linked-change border bg-light my-3 rounded">
      <Collapsible
        trigger={
          <div className="px-3 py-3 row text-dark">
            <div className="col-auto d-flex align-items-center text-dark">
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
                  <span className="rounded-pill badge-pill badge-gray ml-3">
                    {feature?.valueType}
                  </span>
                  {additionalBadge}
                </div>
                <div className="col-auto ml-auto">
                  <Link
                    href={`/features/${feature?.id}`}
                    className="ml-4 link-purple"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View Feature
                    <FaExternalLinkAlt className="ml-1" />
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="col-auto d-flex align-items-center">
                  <span className="text-muted">Page:</span>{" "}
                  <span
                    className="ml-1 d-inline-block text-ellipsis"
                    style={{ width: 300 }}
                  >
                    {page}
                  </span>
                </div>
                <div className="col-auto">
                  <span className="text-muted">Changes:</span>{" "}
                  <span>
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
