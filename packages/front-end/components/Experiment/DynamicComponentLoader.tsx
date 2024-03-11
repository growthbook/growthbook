import React, { Suspense, lazy } from "react";

// Optional: Define a mapping if you have a limited set of components to choose from
const envVarMapping = {
  CustomInfoBanner: process.env.NEXT_PUBLIC_RESULTS_CUSTOM_INFO_BANNER,
};

const componentMapping = {
  CustomInfoBanner: lazy(() => import("./CustomInfoBanner")),
};

const DynamicComponentLoader = ({ componentName }) => {
  if (envVarMapping[componentName] === "false") {
    return null;
  }
  const ComponentToRender = componentMapping[componentName];

  if (!ComponentToRender) {
    return null; // or some fallback UI
  }

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ComponentToRender />
    </Suspense>
  );
};

export default DynamicComponentLoader;
