import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  RedirectToSignIn,
  ClerkLoading,
  useAuth,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { useTheme } from "next-themes";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { HideClerkDevBadge } from "@/components/HideClerkDevBadge";
import { AppShell } from "@/components/layout/AppShell";
import { RepoProvider } from "@/context/RepoContext";
import { ConfigProvider, useConfig } from "@/context/ConfigContext";
import { TeamProvider } from "@/context/TeamContext";
import WorkspacePage from "@/pages/WorkspacePage";
import Dashboard from "@/pages/dashboard";
import Repositories from "@/pages/repositories";
import RepositoryDetail from "@/pages/repository-detail";
import Tasks from "@/pages/tasks";
import TaskDetail from "@/pages/task-detail";
import NewTask from "@/pages/new-task";
import NotFound from "@/pages/not-found";
import HistoryPage from "@/pages/HistoryPage";
import SettingsPage from "@/pages/SettingsPage";
import NewProject from "@/pages/new-project";
import ProjectBoard from "@/pages/project-board";
import RunsPage from "@/pages/runs";
import RunDetailPage from "@/pages/run-detail";
import RunReportPage from "@/pages/run-report";
import AcceptInvitePage from "@/pages/AcceptInvitePage";
import TeamSetupPage from "@/pages/TeamSetupPage";
import { fetchMyTeam } from "@/services/api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const clerkPubKey =
  publishableKeyFromHost(
    window.location.hostname,
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
  ) ?? (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string);

// In dev this is empty; in prod Replit sets it automatically
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL as string | undefined;

function getClerkAppearance(_isDark: boolean) {
  // App is light-only (Modernist). Ignore the theme flag and force the light palette.
  return {
    baseTheme: undefined,
    variables: {
      colorPrimary: "#1a4fd6",
      colorBackground: "#ffffff",
      colorInputBackground: "#ffffff",
      colorInputText: "#161b24",
      colorText: "#161b24",
      colorTextSecondary: "#3c4553",
      colorNeutral: "#3c4553",
      colorDanger: "#c0392b",
      borderRadius: "0px",
      fontFamily: "'Archivo', system-ui, sans-serif",
    },
    elements: {
      card: "shadow-none",
      formButtonPrimary:
        "bg-[#1a4fd6] hover:bg-[#1741b0] text-white rounded-none normal-case tracking-normal",
    },
  };
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function LoadingScreen() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-base)",
        color: "var(--text-muted)",
        fontFamily: "var(--font-sans)",
        fontSize: 14,
      }}
    >
      Loading…
    </div>
  );
}

function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  const clerkAppearance = getClerkAppearance(false);
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#eceff4",
        padding: 24,
        fontFamily: "'Archivo', system-ui, sans-serif",
      }}
    >
      <HideClerkDevBadge />
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#ffffff",
          border: "2px solid color-mix(in srgb, #161b24 38%, transparent)",
          boxShadow: "0 1px 2px rgba(22,27,36,0.04), 0 8px 24px rgba(22,27,36,0.08)",
        }}
      >
        {/* Brand bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "18px 28px",
            borderBottom: "2px solid color-mix(in srgb, #161b24 38%, transparent)",
          }}
        >
          <img
            src={`${basePath}/bluemantis-mark.png`}
            alt=""
            style={{ height: 24, width: "auto", objectFit: "contain" }}
          />
          <span style={{ color: "#161b24", fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em" }}>
            Blue Mantis
          </span>
        </div>

        <div style={{ padding: "28px 28px 32px" }}>
          <h1 style={{ color: "#161b24", fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>
            {mode === "sign-in" ? "Sign in" : "Create your account"}
          </h1>
          <p style={{ color: "#3c4553", fontSize: 14, lineHeight: 1.5, margin: "8px 0 22px" }}>
            {mode === "sign-in"
              ? "Access your AI delivery workspace."
              : "Set up your Blue Mantis workspace."}
          </p>

          {mode === "sign-in" ? (
            <SignIn
              routing="path"
              path={`${basePath}/sign-in`}
              appearance={clerkAppearance}
              signUpUrl={`${basePath}/sign-up`}
              forceRedirectUrl={`${basePath}/dashboard`}
            />
          ) : (
            <SignUp
              routing="path"
              path={`${basePath}/sign-up`}
              appearance={clerkAppearance}
              signInUrl={`${basePath}/sign-in`}
              forceRedirectUrl={`${basePath}/dashboard`}
            />
          )}

          {mode === "sign-in" && (
            <p
              style={{
                color: "#74808f",
                fontSize: 13,
                marginTop: 20,
                paddingTop: 18,
                borderTop: "1px solid #d4dbe5",
              }}
            >
              Don't have an account?{" "}
              {/* Full-page navigation to the marketing site, which opens the Request Access modal. */}
              <a href="/?request-access=1" style={{ color: "#1a4fd6", fontWeight: 700, textDecoration: "none" }}>
                Request access →
              </a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Root: redirect signed-in users to /tasks, others to /sign-in */
function RootRoute() {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return <LoadingScreen />;
  if (isSignedIn) return <Redirect to="/dashboard" />;
  return <Redirect to="/sign-in" />;
}

/** Wraps any route that requires authentication */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <RedirectToSignIn />;
  return <>{children}</>;
}

/**
 * Runs once per browser session after Clerk has confirmed the user is signed in.
 * Calls /api/auth/github-sync to pull the Clerk-held GitHub OAuth token
 * into integration_configs so the GitHub integration is ready automatically.
 *
 * To activate GitHub sign-in: open the Auth pane → Configure → SSO providers
 * → enable GitHub. No code change is needed — it's a one-time Auth pane step.
 */
function useGitHubSync() {
  const { isLoaded, isSignedIn } = useAuth();
  const { refreshConfig } = useConfig();
  const attempted = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (attempted.current) return;
    if (sessionStorage.getItem("gh_sync_done")) return;
    attempted.current = true;

    fetch("/api/auth/github-sync", { method: "POST" })
      .then((r) => r.json())
      .then((data: { ok?: boolean; login?: string }) => {
        if (data.ok) {
          sessionStorage.setItem("gh_sync_done", "1");
          refreshConfig();
        }
      })
      .catch(() => {
        // Silent — GitHub sign-in is optional
      });
  }, [isLoaded, isSignedIn, refreshConfig]);
}

/**
 * After sign-in, if the user has no team yet, send them to the workspace-setup
 * onboarding. /setup and /invite are matched as separate routes above, so this
 * only runs on in-shell pages.
 */
function useEnsureTeam() {
  const { isLoaded, isSignedIn } = useAuth();
  const [, navigate] = useLocation();
  const checked = useRef(false);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || checked.current) return;
    checked.current = true;
    fetchMyTeam()
      .then((r) => {
        if (r.team === null) navigate("/setup");
      })
      .catch(() => {
        // Non-fatal — teams API not reachable; stay on the current page.
      });
  }, [isLoaded, isSignedIn, navigate]);
}

function ProtectedApp() {
  useGitHubSync();
  useEnsureTeam();
  return (
    <RequireAuth>
      <TeamProvider>
      <AppShell>
        <Switch>
          <Route path="/projects/new" component={NewProject} />
          <Route path="/p/:projectId/board" component={ProjectBoard} />
          <Route path="/p/:projectId/runs" component={RunsPage} />
          <Route path="/runs/:runId/report" component={RunReportPage} />
          <Route path="/runs/:runId" component={RunDetailPage} />
          <Route path="/workspace/:taskId" component={WorkspacePage} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/repositories" component={Repositories} />
          <Route path="/repositories/:id" component={RepositoryDetail} />
          <Route path="/tasks" component={Tasks} />
          <Route path="/tasks/new" component={NewTask} />
          <Route path="/tasks/:id" component={TaskDetail} />
          <Route path="/history" component={HistoryPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route component={NotFound} />
        </Switch>
      </AppShell>
      </TeamProvider>
    </RequireAuth>
  );
}

function Router() {
  return (
    <>
      <ClerkLoading>
        <LoadingScreen />
      </ClerkLoading>
      <Switch>
        <Route path="/" component={RootRoute} />
        <Route path="/sign-in" component={() => <AuthPage mode="sign-in" />} />
        <Route path="/sign-in/:rest*" component={() => <AuthPage mode="sign-in" />} />
        <Route path="/sign-up" component={() => <AuthPage mode="sign-up" />} />
        <Route path="/sign-up/:rest*" component={() => <AuthPage mode="sign-up" />} />
        {/* Team onboarding + invite — signed-in but rendered OUTSIDE the AppShell. */}
        <Route path="/setup" component={() => <RequireAuth><TeamSetupPage /></RequireAuth>} />
        <Route path="/invite" component={() => <RequireAuth><AcceptInvitePage /></RequireAuth>} />
        <Route component={ProtectedApp} />
      </Switch>
    </>
  );
}

function ClerkedApp() {
  const { resolvedTheme } = useTheme();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      afterSignOutUrl="/"
      appearance={getClerkAppearance(resolvedTheme !== "light")}
    >
      <QueryClientProvider client={queryClient}>
        <RepoProvider>
          <ConfigProvider>
            <WouterRouter base={basePath}>
              <Router />
            </WouterRouter>
          </ConfigProvider>
        </RepoProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ClerkedApp />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
