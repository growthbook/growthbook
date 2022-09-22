import React, { FC, PropsWithChildren } from "react";

/**
 * A centered card. It can be used for empty states on the data source editing screen for each section
 * @param children
 */
export const EmptyStateCard: FC<PropsWithChildren> = ({ children }) => {
  return (
    <div className="row d-flex justify-content-center">
      <div className="col-xs-12 col-md-6 col-lg-5">
        <div className="card p-4 mb-2">
          <div>
            <div className="d-flex flex-column justify-content-center align-items-center">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
