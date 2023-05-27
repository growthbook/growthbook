import { useEffect, useState } from "react";

export const useContainerDimensions = (myRef) => {
  const [dimensions, setDimensions] = useState({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const getDimensions = () => ({
      top: myRef.current.offsetTop,
      left: myRef.current.offsetLeft,
      width: myRef.current.offsetWidth,
      height: myRef.current.offsetHeight,
    });

    const handleResize = () => {
      setDimensions(getDimensions());
    };

    if (myRef.current) {
      setDimensions(getDimensions());
    }

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [myRef]);

  return dimensions;
};
