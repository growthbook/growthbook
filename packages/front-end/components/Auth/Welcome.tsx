import { ReactElement, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import track from "@/services/track";
import { getApiHost } from "@/services/env";
import Field from "@/components/Forms/Field";
import WelcomeFrame from "./WelcomeFrame";

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

  useEffect(() => {
    if (pathname === "/invitation") {
      setState("register");
    }
  }, [pathname]);

  const welcomeMsg = [
    <>欢迎来到CSII！</>,
    <>你好！欢迎来到CSII</>,
    "你好呀，欢迎！",
    "嘿，在这儿呢！",
  ];
  const cta =
    state === "login"
      ? "登录"
      : state === "register"
        ? "创建账户"
        : state === "forgot"
          ? "找回密码"
          : state === "firsttime"
            ? "注册"
            : "提交";

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
            json.message || "发生错误，请重试。"
          );
        }

        if (state === "register") {
          track("注册");
        }
        if (state === "firsttime") {
          track("首次注册");
        }
        if (state === "forgot") {
          setState("forgotSuccess");
        } else {
          onSuccess(json.token, json.projectId);
        }
      });

  const welcomeContent =
    state === "login" ? (
      <p>欢迎回来，让我们开始一些实验吧</p>
    ) : state === "register" ? (
      <p>
        让我们来做些实验吧！输入您的信息以开始使用。
      </p>
    ) : state === "forgot" ? (
      <p>谁都有可能遇到这种情况呢</p>
    ) : state === "firsttime" ? (
      <>
        <p>
          开始使用CSII只需几分钟。<br />
          首先，我们需要您的一些信息。
        </p>
      </>
    ) : (
      <p>让我们开始一些实验吧</p>
    );

  const leftside = (
    <>
      <h1 className="title h1">{welcomeMsg[welcomeMsgIndex]}</h1>
      {welcomeContent}
    </>
  );

  const email = form.watch("email");

  return (
    <>
      <WelcomeFrame leftside={leftside} loading={loading}>
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
              <h3 className="h2">注册</h3>
              <p>
                已经有账户了？{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setState("login");
                  }}
                >
                  登录
                </a>
              </p>
            </div>
          )}
          {state === "firsttime" && (
            <div>
              <h3 className="h2">设置您的第一个账户</h3>
              <p>
                此信息保存在您的服务器上，绝不会共享。{" "}
                <br />
                您可以稍后邀请团队其他成员。
              </p>
            </div>
          )}
          {state === "login" && (
            <div>
              <h3 className="h2">登录</h3>
              <p>
                还没有账户？{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setState("register");
                  }}
                >
                  注册
                </a>
              </p>
            </div>
          )}
          {state === "forgot" && (
            <div>
              <h3 className="h2">忘记密码</h3>
              <p>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setState("login");
                  }}
                >
                  返回登录
                </a>
              </p>
            </div>
          )}
          {state === "forgotSuccess" && (
            <div>
              <h3 className="h2">忘记密码</h3>
              <div className="alert alert-success">
                密码重置链接已发送至 <strong>{email}</strong>。
              </div>
              <p>点击邮件中的链接重置密码。</p>
              <p>
                发错邮箱了或者需要重新发送？{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setState("forgot");
                  }}
                >
                  返回
                </a>
              </p>
            </div>
          )}
          {state === "firsttime" && (
            <Field
              label="公司名称"
              required
              autoFocus
              minLength={2}
              {...form.register("companyname")}
            />
          )}
          {(state === "register" || state === "firsttime") && (
            <Field
              label="姓名"
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
                label="邮箱地址"
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
                label="密码"
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
                      忘记密码？
                    </a>
                  ) : null
                }
              />
            )}
          {error && <div className="alert alert-danger mr-auto">{error}</div>}
          <button className={`btn btn-primary btn-block btn-lg`} type="submit">
            {cta}
          </button>
        </form>
      </WelcomeFrame>
    </>
  );
}
