import { FC } from "react";
import PageHead from "@/components/Layout/PageHead";

const NewCustomRolePage: FC = () => {
  return (
    <>
      <PageHead
        breadcrumb={[
          {
            display: "Members",
            href: `/settings/team#roles`,
          },
          { display: "New" },
        ]}
      />
      <h1>Hi From New Custom Role Page</h1>
    </>
  );
};

export default NewCustomRolePage;
