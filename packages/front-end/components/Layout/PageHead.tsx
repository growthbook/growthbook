import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

interface PageHeadContextInterface {
  pageTitle: string;
  setPageTitle: (title: string) => void;
}

export const PageHeadContext = createContext<PageHeadContextInterface>({
  pageTitle: "",
  setPageTitle: () => undefined,
});

export function usePageHead() {
  return useContext(PageHeadContext);
}

export function PageHeadProvider({
  children,
  pageComponent,
}: {
  children: ReactNode;
  // eslint-disable-next-line
  pageComponent: any;
}) {
  const [pageTitle, setPageTitle] = useState("");

  // Reset page title when the page component changes
  useEffect(() => {
    setPageTitle("");
  }, [pageComponent]);

  return (
    <PageHeadContext.Provider value={{ pageTitle, setPageTitle }}>
      {children}
    </PageHeadContext.Provider>
  );
}

export default function PageTitle({
  children,
}: {
  children: string | string[];
}) {
  const { setPageTitle, pageTitle } = useContext(PageHeadContext);

  // Passing in a compound string with interpolation comes in as an array of string
  const desiredPageTitle = Array.isArray(children)
    ? children.join("")
    : children;

  useEffect(() => {
    if (pageTitle !== desiredPageTitle) {
      setPageTitle(desiredPageTitle);
    }
  }, [desiredPageTitle, pageTitle, setPageTitle]);

  return null;
}
