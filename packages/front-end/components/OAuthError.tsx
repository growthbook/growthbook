import Button from "@/components/Button";
import {
  getPostAuthRedirectPath,
  redirectWithTimeout,
  safeLogout,
} from "@/services/auth";
import Callout from "@/ui/Callout";

export const OAuthError = ({ error }: { error: string }) => (
  <div>
    <Callout status="error" mt="5">
      <strong>OAuth Error:</strong> {error}
    </Callout>
    <div className="row">
      <div className="col-auto">
        <Button
          color="primary"
          onClick={async () => {
            await redirectWithTimeout(getPostAuthRedirectPath());
          }}
        >
          Retry
        </Button>
      </div>
      <div className="col-auto">
        <Button
          color="outline-primary"
          onClick={async () => {
            await safeLogout();
          }}
        >
          Logout
        </Button>
      </div>
    </div>
  </div>
);
