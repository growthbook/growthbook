import React from "react";
import GetStarted from "../components/HomePage/GetStarted";

const getStartedPage = (): React.ReactElement => {
  return (
    <>
      <div className="container-fluid mt-3 pagecontents getstarted">
        <GetStarted />
      </div>
    </>
  );
};

export default getStartedPage;
