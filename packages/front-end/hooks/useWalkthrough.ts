import { driver, DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useMemo } from "react";

export const useWalkthrough = (steps: DriveStep[]) => {
  const driverjs = useMemo(() => {
    return driver({
      showProgress: true,
      steps,
    });
  }, [steps]);

  return { startWalkthrough: () => driverjs.drive() };
};
