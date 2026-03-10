import Button from "@/components/Button";
import { redirectWithTimeout, safeLogout } from "@/services/auth";

export const OAuthError = ({ error }: { error: string }) => (
  <div>
    <div className="mt-5 alert alert-danger">
      <strong>OAuth Error:</strong> {error}
    </div>
    <div className="row">
      <div className="col-auto">
        <Button
          color="primary"
          onClick={async () => {
            await redirectWithTimeout(window.location.origin);
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
