import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import type { BreadcrumbItem } from "@/ui/Breadcrumbs";

interface PageHeadContextInterface {
  breadcrumb: BreadcrumbItem[];
  setBreadcrumb: (breadcrumb: BreadcrumbItem[]) => void;
}

export const PageHeadContext = createContext<PageHeadContextInterface>({
  breadcrumb: [],
  setBreadcrumb: () => undefined,
});

export function usePageHead() {
  return useContext(PageHeadContext);
}

export function PageHeadProvider({ children }: { children: ReactNode }) {
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);

  return (
    <PageHeadContext.Provider value={{ breadcrumb, setBreadcrumb }}>
      {children}
    </PageHeadContext.Provider>
  );
}

export default function PageHead({
  breadcrumb,
}: {
  breadcrumb: BreadcrumbItem[];
}) {
  const { setBreadcrumb } = useContext(PageHeadContext);

  const newVal = JSON.stringify(breadcrumb);

  useEffect(() => {
    setBreadcrumb(breadcrumb);
    // Unset when the page unmounts
    return () => {
      setBreadcrumb([]);
    };
    // eslint-disable-next-line
  }, [newVal, setBreadcrumb]);

  return null;
}
