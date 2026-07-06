import * as Sentry from "@sentry/nextjs";
import { NextPageContext } from "next";
import Error, { ErrorProps } from "next/error";
import { reportException } from "@/services/errorReporting";

const ErrorWrapper = (props: ErrorProps) => {
  return <Error {...props} />;
};

ErrorWrapper.getInitialProps = async (contextData: NextPageContext) => {
  await Sentry.captureUnderscoreErrorException(contextData);

  reportException(
    contextData.err ??
      new Error(
        `Next.js error page${
          contextData.res?.statusCode ? ` (${contextData.res.statusCode})` : ""
        }`,
      ),
    {
      errorType: "next-error",
      transaction: contextData.asPath,
      handled: false,
    },
  );

  return Error.getInitialProps(contextData);
};

export default ErrorWrapper;
