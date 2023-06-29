import React, { ReactNode } from "react";
import { FaAngleRight, FaFlag } from "react-icons/fa";
import Collapsible from "react-collapsible";
import { RxDesktop } from "react-icons/rx";

type LinkedChangeProps = {
  changeType: "flag" | "visual";
  page?: string;
  changes?: string[];
  setOpen: (v: boolean) => void;
  open: boolean;
  children?: ReactNode;
};

export default function LinkedChange({
  changeType,
  page,
  changes,
  setOpen,
  open,
  children,
}: LinkedChangeProps) {
  return (
    <div className="linked-change border bg-light">
      <Collapsible
        trigger={
          <div className="px-3 py-3 row">
            <div className="col-auto">
              <FaAngleRight className="chevron" />
            </div>
            {changeType === "flag" ? (
              <>
                <div
                  className="col-auto text-uppercase d-flex align-items-center"
                  style={{ width: 150 }}
                >
                  <FaFlag />
                  <div className="ml-1 small">Feature Flag</div>
                </div>
              </>
            ) : (
              <>
                <div
                  className="col-auto text-uppercase d-flex align-items-center"
                  style={{ width: 150 }}
                >
                  <RxDesktop />
                  <div className="ml-1 small">Visual Editor</div>
                </div>
                <div className="col-3 text-body d-flex align-items-center">
                  <span className="text-muted">Page:</span>{" "}
                  <span className="ml-1 d-inline-block text-ellipsis">
                    {page}
                  </span>
                </div>
                <div className="col-3 pl-3 text-body">
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
        onTriggerOpening={() => setOpen(true)}
        onTriggerClosing={() => setOpen(false)}
        transitionTime={150}
      >
        <div className="border-top mx-3 mb-3"></div>
        {children}
      </Collapsible>
    </div>
  );
}
