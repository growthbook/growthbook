import { ReactElement, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import { useFeatureValue } from "@growthbook/growthbook-react";
import { Flex, Box } from "@radix-ui/themes";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import track from "@/services/track";
import Text from "@/ui/Text";
import { getApiHost } from "@/services/env";
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

type WelcomeState =
  | "login"
  | "register"
  | "forgot"
  | "forgotSuccess"
  | "firsttime";

// Returns null for states that have no submit button.
function getSubmitLabel(state: WelcomeState): MessageDescriptor | null {
  switch (state) {
    case "login":
      return msg`Log in`;
    case "register":
      return msg`Create Account`;
    case "forgot":
      return msg`Look up`;
    case "firsttime":
      return msg`Sign up`;
    case "forgotSuccess":
      return null;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export default function Welcome({
  onSuccess,
  firstTime = false,
}: {
  onSuccess: (token: string, projectId?: string) => void;
  firstTime?: boolean;
}): ReactElement {
  const { t, i18n } = useLingui();
  const [state, setState] = useState<WelcomeState>(
    firstTime ? "firsttime" : "login",
  );
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
    t`Welcome to GrowthBook!`,
    t`Hello! Welcome to GrowthBook`,
    t`Hello there, Welcome!`,
    t`Hey there!`,
  ];
  const cta = getSubmitLabel(state);

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
              json.message || t`An error occurred. Please try again.`,
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
      <p>
        <Trans>
          Welcome back, let&apos;s get started with some experiments
        </Trans>
      </p>
    ) : state === "register" ? (
      <p>
        <Trans>
          Let&apos;s run some experiments! Enter your information to get
          started.
        </Trans>
      </p>
    ) : state === "forgot" ? (
      <p>
        <Trans>Happens to the best of us</Trans>
      </p>
    ) : state === "firsttime" ? (
      <>
        <p>
          <Trans>
            Getting started with GrowthBook only takes a few minutes. <br />
            To start, we&apos;ll need a bit of information about you.
          </Trans>
        </p>
      </>
    ) : (
      <p>
        <Trans>Let&apos;s get started with some experimentation</Trans>
      </p>
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
                <Text as="span" size="sm" textTransform="uppercase">
                  -- {hero.type} --
                </Text>
              )}
              <Heading size="xl" weight="medium" as="h2" mt="4" mb="4">
                {hero.headline}
              </Heading>
              {hero.subhead && (
                <Heading size="md" weight="semibold" as="h3" mb="1">
                  {hero.subhead}
                </Heading>
              )}
              {hero.body && (
                <Text as="span" size="md" weight="regular">
                  {hero.body}
                </Text>
              )}
              {ctaText &&
                ctaLink &&
                /^(https?:\/\/|mailto:)/i.test(ctaLink) && (
                  <Box mt="5" mb="5">
                    <WhiteButton
                      variant="outline"
                      size="lg"
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
              <h3 className="h2">
                <Trans>Register</Trans>
              </h3>
              <p>
                <Trans>
                  Already have an account?{" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setState("login");
                    }}
                  >
                    Log In
                  </a>
                </Trans>
              </p>
            </div>
          )}
          {state === "firsttime" && (
            <div>
              <h3 className="h2">
                <Trans>Set up your first account</Trans>
              </h3>
              <p>
                <Trans>
                  This information stays on your servers and is never shared.{" "}
                  <br />
                  You can invite the rest of your team later.
                </Trans>
              </p>
            </div>
          )}
          {state === "login" && (
            <Flex direction="column" mb="5" gap="2">
              <Heading size="xl" weight="medium" as="h1">
                <Trans>Welcome back</Trans>
              </Heading>
              <Text as="span" size="md" weight="regular">
                <Trans>Sign in to your GrowthBook account</Trans>
              </Text>
            </Flex>
          )}
          {state === "forgot" && (
            <div>
              <h3 className="h2">
                <Trans>Forgot Password</Trans>
              </h3>
              <p>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setState("login");
                  }}
                >
                  <Trans>Go back to Log In</Trans>
                </a>
              </p>
            </div>
          )}
          {state === "forgotSuccess" && (
            <div>
              <h3 className="h2">
                <Trans>Forgot Password</Trans>
              </h3>
              <Callout status="success" mb="3">
                <Trans>
                  Password reset link sent to <strong>{email}</strong>.
                </Trans>
              </Callout>
              <p>
                <Trans>
                  Click the link in the email to reset your password.
                </Trans>
              </p>
              <p>
                <Trans>
                  Sent to the wrong email or need to resend?{" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setState("forgot");
                    }}
                  >
                    Go Back
                  </a>
                </Trans>
              </p>
            </div>
          )}
          {state === "firsttime" && (
            <Field
              size="legacy"
              label={t`Company name`}
              required
              autoFocus
              minLength={2}
              {...form.register("companyname")}
            />
          )}
          {(state === "register" || state === "firsttime") && (
            <Field
              size="legacy"
              label={t`Name`}
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
              size="legacy"
              label={t`Email Address`}
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
              size="legacy"
              label={t`Password`}
              required
              type="password"
              {...form.register("password")}
              autoComplete={
                state === "login" ? "current-password" : "new-password"
              }
              minLength={8}
              helpText={
                state === "login" ? (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setState("forgot");
                    }}
                  >
                    <Trans>Forgot Password?</Trans>
                  </a>
                ) : null
              }
            />
          )}
          {error && (
            <Callout status="error" mb="3">
              {error}
            </Callout>
          )}
          {cta !== null && (
            <Button
              type="submit"
              size="xl"
              loading={loading}
              style={{ width: "100%" }}
              mt="5"
              mb="5"
            >
              {i18n._(cta)}
            </Button>
          )}
          {state === "login" && (
            <Flex justify="center" align="center">
              <Text color="text-mid" weight="regular" align="center">
                <Trans>
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
                </Trans>
              </Text>
            </Flex>
          )}
        </form>
      </WelcomeFrame>
    </>
  );
}
