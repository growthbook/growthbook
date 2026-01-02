import TopNav from "./TopNav";

const LayoutLite = (): React.ReactElement => {
  return (
    <>
      <TopNav showNotices={false} pageTitle="Setup" showLogo={false} />
    </>
  );
};

export default LayoutLite;
