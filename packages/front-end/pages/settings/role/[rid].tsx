import { FC } from "react";
import router from "next/router";
import PageHead from "@/components/Layout/PageHead";

const CustomRolePage: FC = () => {
  const { rid } = router.query;
  return (
    <>
      <PageHead
        breadcrumb={[
          {
            display: "Members",
            href: `/settings/team#roles`,
          },
          { display: `${rid}` },
        ]}
      />
      <h1>Hi From Custom RoleId Page</h1>
    </>
  );
};

export default CustomRolePage;
