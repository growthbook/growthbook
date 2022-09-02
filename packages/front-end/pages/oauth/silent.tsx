import LoadingOverlay from "../../components/LoadingOverlay";

export default function OAuthSilentCallbackPage() {
  return (
    <div className="container">
      <LoadingOverlay />
    </div>
  );
}
OAuthSilentCallbackPage.preAuth = true;
