import React, { ReactNode } from "react";
import { FaAngleRight, FaExternalLinkAlt } from "react-icons/fa";
import Collapsible from "react-collapsible";
import { RxDesktop } from "react-icons/rx";
import { BsFlag } from "react-icons/bs";
import { FeatureInterface } from "back-end/types/feature";

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
                <div
                  className="col-auto text-uppercase d-flex align-items-center"
                  style={{ width: 170 }}
                >
                  <BsFlag />
                  <div className="ml-1 small">Feature Flag</div>
                </div>
                <div
                  className="col-3 d-flex align-items-center"
                  style={{ minWidth: 200 }}
                >
                  <span className="text-muted hover-label">Key:</span>{" "}
                  <span className="ml-1 d-inline-block text-ellipsis hover-label">
                    {feature?.id}
                  </span>
                </div>
                <div className="col-3 pl-3">
                  <span className="text-muted hover-label">Type:</span>{" "}
                  <span className="ml-1 hover-label">{feature?.valueType}</span>
                </div>
                <div className="flex-1"></div>
                <div className="col-auto">
                  <a
                    href={`/features/${feature?.id}`}
                    target="_blank"
                    className="ml-4"
                    onClick={(e) => e.stopPropagation()}
                    rel="noreferrer"
                  >
                    manage feature <FaExternalLinkAlt />
                  </a>
                </div>
              </>
            ) : (
              <>
                <div
                  className="col-auto text-uppercase d-flex align-items-center"
                  style={{ width: 170 }}
                >
                  <RxDesktop />
                  <div className="ml-1 small">Visual Editor</div>
                </div>
                <div
                  className="col-3 d-flex align-items-center"
                  style={{ minWidth: 200 }}
                >
                  <span className="text-muted hover-label">Page:</span>{" "}
                  <span className="ml-1 d-inline-block text-ellipsis hover-label">
                    {page}
                  </span>
                </div>
                <div className="col-3 pl-3">
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
