import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

interface BreadCrumbItem {
  display: string;
  href?: string;
}

interface PageHeadContextInterface {
  breadcrumb: BreadCrumbItem[];
  setBreadcrumb: (breadcrumb: BreadCrumbItem[]) => void;
}

export const PageHeadContext = createContext<PageHeadContextInterface>({
  breadcrumb: [],
  setBreadcrumb: () => undefined,
});

export function usePageHead() {
  return useContext(PageHeadContext);
}

export function PageHeadProvider({ children }: { children: ReactNode }) {
  const [breadcrumb, setBreadcrumb] = useState<BreadCrumbItem[]>([]);

  return (
    <PageHeadContext.Provider value={{ breadcrumb, setBreadcrumb }}>
      {children}
    </PageHeadContext.Provider>
  );
}

export default function PageHead({
  breadcrumb,
}: {
  breadcrumb: BreadCrumbItem[];
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
