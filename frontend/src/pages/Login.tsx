import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  GoogleLogin,
  GoogleOAuthProvider,
  type CredentialResponse,
} from "@react-oauth/google";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useGoogleAuthConfig } from "@/lib/queries";
import { safeRedirectPath } from "@/lib/safeRedirect";
import { BrandMark } from "@/components/BrandMark";
import { Alert, AlertDescription } from "@/components/reui/alert";

function messageForApiError(err: ApiError): string {
  const code =
    typeof err.body === "object" && err.body !== null && "code" in err.body
      ? String((err.body as { code?: unknown }).code ?? "")
      : "";
  switch (code) {
    case "domain_not_allowed":
      return "Your Google account isn't on the allowed domain list. Contact your admin.";
    case "email_not_verified":
      return "Your Google account email isn't verified.";
    case "oauth_not_configured":
      return "Google sign-in isn't configured yet. Ask your admin to set up Sign-in policy.";
    case "account_disabled":
      return "This account has been deactivated. Contact your admin.";
    case "google_only":
      return "This account uses Google sign-in. Use the Google button above.";
    case "invalid_credentials":
      return "Invalid email or password.";
    case "invalid_token":
      return "Google sign-in failed. Please try again.";
    default:
      return err.message || "Sign-in failed.";
  }
}

export function Login() {
  const { status, login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Shared by the password path, the Google path and the already-signed-in
  // redirect below; only an in-app path is accepted.
  // The guard passes it through router state; the embed views' "Sign in" link
  // opens this page in a new tab, where only a `?from=` query can carry it.
  const from = safeRedirectPath(
    (location.state as { from?: unknown } | null)?.from ??
      new URLSearchParams(location.search).get("from"),
  );

  // Runtime-fetched OAuth config — clientId comes from the DB (Admin > Sign-in),
  // not the build. `enabled` is true only when both clientId and at least one
  // allowed domain are configured.
  const { data: googleConfig, isLoading: googleConfigLoading } =
    useGoogleAuthConfig();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const googleAvailable = Boolean(googleConfig?.enabled && googleConfig.clientId);

  if (status === "authenticated") {
    return <Navigate to={from} replace />;
  }

  async function handleGoogleCredential(res: CredentialResponse) {
    if (!res.credential) {
      setError("Google sign-in did not return a credential. Please try again.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await loginWithGoogle(res.credential);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(messageForApiError(err));
      else setError("Could not reach the server. Is the backend running?");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(messageForApiError(err));
      else setError("Could not reach the server. Is the backend running?");
    } finally {
      setSubmitting(false);
    }
  }

  // `dark` is hard-pinned on the root below: the login screen always renders
  // in dark mode regardless of the user's theme preference. Scoping the class
  // to this subtree makes every CSS-var token resolve to its `.dark` value.
  return (
    <div className="dark grid h-screen grid-cols-1 overflow-hidden bg-background md:grid-cols-[44%_1fr]">
      {/* Left brand panel. Wordmark pinned top, footer pinned bottom; the hero
          copy gets `my-auto` to vertically center it in the space between. */}
      <div className="relative hidden flex-col overflow-hidden bg-background p-10 md:flex">
        {/* Decorative rings */}
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-full border border-primary/12"
          style={{ width: 280, height: 280, top: -80, right: -80 }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-full border border-primary/12"
          style={{ width: 200, height: 200, bottom: -60, left: -60 }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-full border border-primary/6"
          style={{ width: 120, height: 120, bottom: 80, right: 20 }}
        />

        {/* Wordmark */}
        <div className="relative z-10 flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span
            className="text-white"
            style={{ fontSize: 15, fontWeight: 500, letterSpacing: "-0.2px" }}
          >
            Solvro
          </span>
        </div>

        {/* Hero copy */}
        <div className="relative z-10 my-auto">
          <div
            className="mb-3 font-semibold text-primary"
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Project Operations
          </div>
          <h1
            className="text-white"
            style={{
              fontSize: 40,
              fontWeight: 600,
              letterSpacing: "-1px",
              lineHeight: 1.1,
            }}
          >
            Manage projects.
            <br />
            <span className="text-primary">Ship</span> on time.
          </h1>
          <p
            className="mt-3 text-on-surface-variant/45"
            style={{
              fontSize: 12,
              maxWidth: 240,
              lineHeight: 1.6,
            }}
          >
            One place to track projects, log updates, and report to customers.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {["Project tracking", "Daily notes", "Customer reports"].map(
              (label) => (
                <span
                  key={label}
                  className="rounded-full border border-primary/30 text-primary/80"
                  style={{
                    fontSize: 10,
                    padding: "3px 10px",
                  }}
                >
                  {label}
                </span>
              ),
            )}
          </div>
        </div>

        {/* Footer version/build */}
        <div
          className="relative z-10 text-on-surface-variant/20"
          style={{ fontSize: 10 }}
        >
          v1.4.0 · build 2305
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-col items-center justify-center bg-surface px-8">
        <div className="w-full" style={{ maxWidth: 280 }}>
          {/* Mobile-only wordmark */}
          <div className="mb-8 flex items-center gap-2.5 md:hidden">
            <BrandMark className="h-8 w-8" />
            <span
              className="text-on-surface"
              style={{ fontSize: 15, fontWeight: 500, letterSpacing: "-0.2px" }}
            >
              Solvro
            </span>
          </div>

          <h2
            className="text-on-surface"
            style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.3px" }}
          >
            Sign in
          </h2>
          <p
            className="mb-8 mt-1 text-on-surface-variant"
            style={{ fontSize: 12 }}
          >
            {googleAvailable
              ? "Use your work Google account."
              : "Sign in with your Solvro credentials."}
          </p>

          {googleConfigLoading ? (
            <div className="h-10 animate-pulse rounded-sm bg-surface-container" />
          ) : googleAvailable ? (
            <GoogleOAuthProvider clientId={googleConfig!.clientId!}>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleCredential}
                  onError={() =>
                    setError("Google sign-in failed. Please try again.")
                  }
                  theme="filled_blue"
                  text="signin_with"
                  shape="rectangular"
                  width="320"
                />
              </div>
            </GoogleOAuthProvider>
          ) : null}

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {googleAvailable && (
            <>
              {/* Divider */}
              <div className="my-6 flex items-center gap-3 text-label-caps uppercase text-on-surface-variant">
                <div
                  className="flex-1 bg-outline-variant"
                  style={{ height: "0.5px" }}
                />
                <span>or</span>
                <div
                  className="flex-1 bg-outline-variant"
                  style={{ height: "0.5px" }}
                />
              </div>

              {/* Admin sign-in (password fallback). Collapsed by default —
                  only the seeded admin and any explicitly password-provisioned
                  account can use this; every other user has passwordHash NULL
                  server-side. */}
              <details className="group rounded-sm border border-outline-variant bg-surface-container-lowest open:bg-surface-container">
                <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-on-surface marker:hidden">
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base text-on-surface-variant">
                      key
                    </span>
                    Admin sign-in (password)
                  </span>
                  <span className="material-symbols-outlined text-base text-on-surface-variant transition-transform group-open:rotate-180">
                    expand_more
                  </span>
                </summary>

                <div className="border-t border-outline-variant px-3 py-3">
                  <PasswordForm
                    email={email}
                    setEmail={setEmail}
                    password={password}
                    setPassword={setPassword}
                    showPassword={showPassword}
                    setShowPassword={setShowPassword}
                    submitting={submitting}
                    onSubmit={handlePasswordSubmit}
                  />
                </div>
              </details>
            </>
          )}

          {!googleConfigLoading && !googleAvailable && (
            <PasswordForm
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              submitting={submitting}
              onSubmit={handlePasswordSubmit}
            />
          )}

          {/* Footer */}
          <p
            className="mt-6 text-center text-on-surface-variant/60"
            style={{ fontSize: 10 }}
          >
            Internal use only · Elitery © 2026
          </p>
        </div>
      </div>
    </div>
  );
}

interface PasswordFormProps {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (fn: (v: boolean) => boolean) => void;
  submitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function PasswordForm({
  email,
  setEmail,
  password,
  setPassword,
  showPassword,
  setShowPassword,
  submitting,
  onSubmit,
}: PasswordFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <label className="block">
        <span className="text-label-caps uppercase text-on-surface-variant">
          Email
        </span>
        <div className="mt-1 flex items-center gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(58,174,81,0.15)]">
          <span className="material-symbols-outlined text-base text-on-surface-variant">
            mail
          </span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-hidden"
          />
        </div>
      </label>

      <label className="block">
        <span className="text-label-caps uppercase text-on-surface-variant">
          Password
        </span>
        <div className="mt-1 flex items-center gap-2 rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(58,174,81,0.15)]">
          <span className="material-symbols-outlined text-base text-on-surface-variant">
            lock
          </span>
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-hidden"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="text-on-surface-variant hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-base">
              {showPassword ? "visibility_off" : "visibility"}
            </span>
          </button>
        </div>
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="mt-1 w-full rounded-sm bg-ink py-2 font-display text-sm font-semibold text-white transition-colors hover:bg-ink-hover disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
