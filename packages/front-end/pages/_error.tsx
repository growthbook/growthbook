import * as Sentry from "@sentry/nextjs";
import type { NextPageContext } from "next";
import type { ErrorProps } from "next/error";
import Error from "next/error";

const ErrorWrapper = (props: ErrorProps) => {
  return <Error {...props} />;
};

ErrorWrapper.getInitialProps = async (contextData: NextPageContext) => {
  await Sentry.captureUnderscoreErrorException(contextData);
  return Error.getInitialProps(contextData);
};

export default ErrorWrapper;
