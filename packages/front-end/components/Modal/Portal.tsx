import { FC, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const Portal: FC = ({ children }) => {
  const ref = useRef<HTMLElement>();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    ref.current = document.getElementById("modal");
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return ref.current ? createPortal(children, ref.current) : <>{children}</>;
};
export default Portal;
