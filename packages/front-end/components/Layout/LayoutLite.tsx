import { useLingui } from "@lingui/react/macro";
import TopNav from "./TopNav";

const LayoutLite = (): React.ReactElement => {
  const { t } = useLingui();
  return (
    <>
      <TopNav showNotices={false} pageTitle={t`Setup`} showLogo={false} />
    </>
  );
};

export default LayoutLite;
