import { ReactNode, FC, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const PORTAL_CONTAINER_ID = "portal-root";

const Portal: FC<{ children: ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLElement>();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = document.getElementById(PORTAL_CONTAINER_ID);
    if (!el) {
      return;
    }
    ref.current = el;
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return ref.current ? createPortal(children, ref.current) : <>{children}</>;
};
export default Portal;
