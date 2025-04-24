import { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async ({
  res,
  query: { state, code, resource_id: resourceId },
}) => {
  const apiHost =
    (process.env.API_HOST ?? "").replace(/\/$/, "") || "http://localhost:3100";

  try {
    const r = await fetch(`${apiHost}/vercel/auth/sso`, {
      method: "POST",
      body: JSON.stringify({
        code,
        state,
        resourceId,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    r.headers
      .getSetCookie()
      .forEach((cookie) => res.setHeader("Set-Cookie", cookie));
  } catch (err) {
    console.log("Ignored:", err);
  }

  return {
    redirect: {
      destination: "/",
      permanent: false,
    },
  };
};

export default function Vercel() {
  return "bla";
}
