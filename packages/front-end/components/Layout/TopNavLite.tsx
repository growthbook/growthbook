import Head from "next/head";
import { safeLogout } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Avatar from "../Avatar/Avatar";
import Button from "../Button";
import { ThemeToggler } from "./ThemeToggler/ThemeToggler";

export default function TopNavLite() {
  const { email } = useUser();
  return (
    <div className="navbar bg-white border-bottom">
      <Head>
        <title>GrowthBook</title>
      </Head>
      <div>
        <img
          alt="GrowthBook"
          src="/logo/growthbook-logo.png"
          style={{ height: 36 }}
        />
      </div>
      <div className="ml-auto">
        <ThemeToggler />
      </div>
      {email && (
        <div className="mr-2">
          <Avatar email={email} size={26} />{" "}
          <span className="d-none d-lg-inline">{email}</span>
        </div>
      )}
      <div>
        <Button
          onClick={async () => {
            await safeLogout();
          }}
          color="danger"
        >
          Log Out
        </Button>
      </div>
    </div>
  );
}
