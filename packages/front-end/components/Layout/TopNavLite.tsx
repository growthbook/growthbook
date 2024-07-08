import Head from "next/head";
import { safeLogout } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Avatar from "@/components/Avatar/Avatar";
import Button from "@/components/Button";
import { ThemeToggler } from "./ThemeToggler/ThemeToggler";

export default function TopNavLite() {
  const { email, name, user } = useUser();
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
        <div className="mr-4 d-flex">
          <Avatar email={email} size={26} name={name || ""} className="mr-2" />{" "}
          <span className="d-none d-lg-inline">{email}</span>
        </div>
      )}
      <div>
        {user && (
          <Button
            onClick={async () => {
              await safeLogout();
            }}
            color="danger"
          >
            Log Out
          </Button>
        )}
      </div>
    </div>
  );
}
