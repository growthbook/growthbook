import * as Sentry from "@sentry/nextjs";
import { NextPageContext } from "next";
import Error, { ErrorProps } from "next/error";

const ErrorWrapper = (props: ErrorProps) => {
  return <Error {...props} />;
};

ErrorWrapper.getInitialProps = async (contextData: NextPageContext) => {
  await Sentry.captureUnderscoreErrorException(contextData);
  return Error.getInitialProps(contextData);
};

export default ErrorWrapper;
