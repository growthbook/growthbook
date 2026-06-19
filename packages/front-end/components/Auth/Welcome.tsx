import { ReactElement, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import { useFeatureValue } from "@growthbook/growthbook-react";
import { Flex, Box } from "@radix-ui/themes";
import track from "@/services/track";
import Text from "@/ui/Text";
import { getApiHost } from "@/services/env";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import Button, { WhiteButton } from "@/ui/Button";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import WelcomeFrame from "./WelcomeFrame";

type LoginHeroContent = {
  headline: string;
  type?: string;
  subhead?: string;
  body?: string;
  image?: string;
  cta?: string;
  link?: string;
};

export default function Welcome({
  onSuccess,
  firstTime = false,
}: {
  onSuccess: (token: string, projectId?: string) => void;
  firstTime?: boolean;
}): ReactElement {
  const [state, setState] = useState<
    "login" | "register" | "forgot" | "forgotSuccess" | "firsttime"
  >(firstTime ? "firsttime" : "login");
  const form = useForm({
    defaultValues: {
      companyname: "",
      name: "",
      email: "",
      password: "",
    },
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [welcomeMsgIndex] = useState(Math.floor(Math.random() * 4));
  const { pathname } = useRouter();
  const hero = useFeatureValue<LoginHeroContent | null>(
    "login-page-content",
    null,
  );

  useEffect(() => {
    if (pathname === "/invitation") {
      setState("register");
    }
  }, [pathname]);

  const welcomeMsg = [
    <>Welcome to GrowthBook!</>,
    <>Hello! Welcome to GrowthBook</>,
    "Hello there, Welcome!",
    "Hey there!",
  ];
  const cta =
    state === "login"
      ? "Log in"
      : state === "register"
        ? "Create Account"
        : state === "forgot"
          ? "Look up"
          : state === "firsttime"
            ? "Sign up"
            : "Submit";

  const submit =
    state === "forgotSuccess"
      ? undefined
      : form.handleSubmit(async (data) => {
          const res = await fetch(getApiHost() + "/auth/" + state, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify(data),
          });
          const json: {
            status: number;
            token: string;
            message?: string;
            projectId?: string;
          } = await res.json();
          if (json.status > 200) {
            throw new Error(
              json.message || "An error occurred. Please try again.",
            );
          }

          if (state === "register") {
            track("Register");
          }
          if (state === "firsttime") {
            track("Register-first");
          }
          if (state === "forgot") {
            setState("forgotSuccess");
          } else {
            onSuccess(json.token, json.projectId);
          }
        });

  const welcomeContent =
    state === "login" ? (
      <p>Welcome back, lets get started with some experiments</p>
    ) : state === "register" ? (
      <p>
        Let&apos;s run some experiments! Enter your information to get started.
      </p>
    ) : state === "forgot" ? (
      <p>Happens to the best of us</p>
    ) : state === "firsttime" ? (
      <>
        <p>
          Getting started with GrowthBook only takes a few minutes. <br />
          To start, we&apos;ll need a bit of information about you.
        </p>
      </>
    ) : (
      <p>Let&apos;s get started with some experimentation</p>
    );

  const ctaText = hero?.cta?.trim();
  const ctaLink = hero?.link?.trim();

  const leftside = (
    <Flex direction="column" justify="between" height="100%" p="6">
      <Box>
        <a href="https://www.growthbook.io" target="_blank" rel="noreferrer">
          <img
            src="/logo/growth-book-logo-white.svg"
            style={{ maxWidth: "150px" }}
            alt="GrowthBook"
          />
        </a>
      </Box>
      <Box>
        {hero?.headline ? (
          <>
            {hero.image && (
              <img
                src={hero.image}
                alt=""
                style={{ width: "100%", height: "auto", marginBottom: "48px" }}
              />
            )}
            <Box>
              {hero.type && (
                <Text as="span" size="small" textTransform="uppercase">
                  -- {hero.type} --
                </Text>
              )}
              <Heading size="x-large" weight="medium" as="h2" mt="4" mb="4">
                {hero.headline}
              </Heading>
              {hero.subhead && (
                <Heading size="medium" weight="semibold" as="h3" mb="1">
                  {hero.subhead}
                </Heading>
              )}
              {hero.body && (
                <Text as="span" size="medium" weight="regular">
                  {hero.body}
                </Text>
              )}
              {ctaText &&
                ctaLink &&
                /^(https?:\/\/|mailto:)/i.test(ctaLink) && (
                  <Box mt="5" mb="5">
                    <WhiteButton
                      variant="outline"
                      size="md"
                      fullWidth={false}
                      onClick={() =>
                        window.open(ctaLink, "_blank", "noopener,noreferrer")
                      }
                    >
                      {ctaText}
                    </WhiteButton>
                  </Box>
                )}
            </Box>
          </>
        ) : (
          <Box mb="9">
            <h1 className="title h1">{welcomeMsg[welcomeMsgIndex]}</h1>
            {welcomeContent}
          </Box>
        )}
      </Box>
    </Flex>
  );

  const email = form.watch("email");

  return (
    <>
      <WelcomeFrame
        leftside={leftside}
        loading={loading}
        pathName={`/${state}`}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (loading) return;
            setError(null);
            setLoading(true);
            try {
              await submit?.();
            } catch (e) {
              setError(e.message);
            }
            setLoading(false);
          }}
        >
          {state === "register" && (
            <div>
              <h3 className="h2">Register</h3>
              <p>
                Already have an account?{" "}
                <Link onClick={() => setState("login")}>Log In</Link>
              </p>
            </div>
          )}
          {state === "firsttime" && (
            <div>
              <h3 className="h2">Set up your first account</h3>
              <p>
                This information stays on your servers and is never shared.{" "}
                <br />
                You can invite the rest of your team later.
              </p>
            </div>
          )}
          {state === "login" && (
            <Flex direction="column" mb="5" gap="2">
              <Heading size="x-large" weight="medium" as="h1">
                Welcome back
              </Heading>
              <Text as="span" size="medium" weight="regular">
                Sign in to your GrowthBook account
              </Text>
            </Flex>
          )}
          {state === "forgot" && (
            <div>
              <h3 className="h2">Forgot Password</h3>
              <p>
                <Link onClick={() => setState("login")}>Go back to Log In</Link>
              </p>
            </div>
          )}
          {state === "forgotSuccess" && (
            <div>
              <h3 className="h2">Forgot Password</h3>
              <Callout status="success" mb="3">
                Password reset link sent to <strong>{email}</strong>.
              </Callout>
              <p>Click the link in the email to reset your password.</p>
              <p>
                Sent to the wrong email or need to resend?{" "}
                <Link onClick={() => setState("forgot")}>Go Back</Link>
              </p>
            </div>
          )}
          {state === "firsttime" && (
            <Field
              label="Company name"
              required
              autoFocus
              minLength={2}
              {...form.register("companyname")}
            />
          )}
          {(state === "register" || state === "firsttime") && (
            <Field
              label="Name"
              required
              {...form.register("name")}
              autoFocus={state === "register"}
              autoComplete="name"
              minLength={2}
            />
          )}
          {(state === "login" ||
            state === "register" ||
            state === "forgot" ||
            state === "firsttime") && (
            <Field
              label="Email Address"
              required
              type="email"
              {...form.register("email")}
              autoFocus={state === "login" || state === "forgot"}
              autoComplete="username"
            />
          )}
          {(state === "login" ||
            state === "register" ||
            state === "firsttime") && (
            <Field
              label="Password"
              required
              type="password"
              {...form.register("password")}
              autoComplete={
                state === "login" ? "current-password" : "new-password"
              }
              minLength={8}
              helpText={
                state === "login" ? (
                  <Link onClick={() => setState("forgot")}>
                    Forgot Password?
                  </Link>
                ) : null
              }
            />
          )}
          {error && (
            <Callout status="error" mb="3">
              {error}
            </Callout>
          )}
          <Button
            type="submit"
            size="lg"
            loading={loading}
            style={{ width: "100%" }}
            mt="5"
            mb="5"
          >
            {cta}
          </Button>
          {state === "login" && (
            <Flex justify="center" align="center">
              <Text color="text-mid" weight="regular" align="center">
                Don&apos;t have an account yet?{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setState("register");
                  }}
                >
                  Start for free
                </a>
              </Text>
            </Flex>
          )}
        </form>
      </WelcomeFrame>
    </>
  );
}
