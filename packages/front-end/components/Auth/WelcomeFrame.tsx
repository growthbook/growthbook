import { ReactNode, FC, ReactElement, useEffect } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import { trackPageView } from "@/services/track";

type WelcomeFrameProps = {
  leftside: string | ReactElement | boolean;
  loading?: boolean;
  children: ReactNode;
  pathName: string;
};
const WelcomeFrame: FC<WelcomeFrameProps> = ({
  leftside,
  children,
  loading: loadingState,
  pathName,
}) => {
  // This page is pre-auth, so need to manually fire a page load event
  useEffect(() => {
    trackPageView(pathName);
  }, [pathName]);

  return (
    <>
      <div className="welcome container-fluid">
        {loadingState && <LoadingOverlay />}
        <div className="row full-height align-items-stretch d-flex flex-fill d-flex justify-content-start">
          <div className="col-sm-6 intro-side">{leftside}</div>
          <div className="col-sm-6 form-side p-0 position-relative">
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
