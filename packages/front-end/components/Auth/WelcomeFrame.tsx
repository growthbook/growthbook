import { ReactNode, FC, ReactElement, useState } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";

type WelcomeFrameProps = {
  leftside: string | ReactElement | boolean;
  loading?: boolean;
  children: ReactNode;
};
const WelcomeFrame: FC<WelcomeFrameProps> = ({
  leftside,
  children,
  loading: loadingState,
}) => {
  const [loading] = useState(loadingState);

  return (
    <>
      <div className="welcome container-fluid">
        {loading && <LoadingOverlay />}
        <div className="row full-height align-items-stretch d-flex flex-fill d-flex justify-content-start">
          <div className="col-sm-5 intro-side ">
            <div className="ghosted-logo"></div>
            <div className="p-sm-1 p-md-3 pt-3 pt-sm-3 pt-md-5 d-flex align-items-center justify-content-center h-100">
              <div className="text-center">{leftside}</div>
            </div>
            <div className="logo">
              <a
                href="https://www.growthbook.io"
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src="/logo/growth-book-logo-white.png"
                  style={{ maxWidth: "150px" }}
                />
              </a>
            </div>
          </div>
          <div className="col-sm-7 form-side p-0">
            <div className="welcomemodal p-4 h-100">
              <div className="h-100 align-items-center justify-content-center d-flex pr-2">
                <div className="formwrap">{children}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default WelcomeFrame;
