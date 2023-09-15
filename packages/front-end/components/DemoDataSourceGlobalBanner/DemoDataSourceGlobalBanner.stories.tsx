import { DemoDataSourceGlobalBanner } from "./DemoDataSourceGlobalBanner";

export default {
  component: DemoDataSourceGlobalBanner,
  title: "Feedback/DemoDataSourceGlobalBanner",
};

export const Default = () => {
  return (
    <>
      <DemoDataSourceGlobalBanner currentProjectIsDemo={true} ready={true} />
    </>
  );
};
