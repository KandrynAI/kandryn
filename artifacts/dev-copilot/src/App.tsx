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
import { useTheme } from "next-themes";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { HideClerkDevBadge } from "@/components/HideClerkDevBadge";
import { AppShell } from "@/components/layout/AppShell";
import { Logo } from "@/components/Logo";
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
import ProjectSettingsPage from "@/pages/ProjectSettingsPage";
import GovernancePage from "@/pages/GovernancePage";
import ProjectBoard from "@/pages/project-board";
import RunsPage from "@/pages/runs";
import RunDetailPage from "@/pages/run-detail";
import RunReportPage from "@/pages/run-report";
import ReportsPage from "@/pages/ReportsPage";
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

// The publishable key encodes its own Frontend API host, so it is the single
// source of truth. Deriving it from window.location.hostname instead (the
// previous behaviour) breaks whenever the app's host and the Clerk domain
// differ — on app.kandryn.com it produced clerk.app.kandryn.com, which does
// not exist. The Clerk domain is clerk.kandryn.com.
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

// In dev this is empty; in prod Replit sets it automatically
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL as string | undefined;

function getClerkAppearance(_isDark: boolean) {
  // App is light-only (Modernist). Ignore the theme flag and force the light palette.
  // Element styles are passed as CSSProperties objects (Clerk applies them as
  // inline styles) so they take effect regardless of the CDN clerk-js version —
  // raw CSS-declaration strings would be treated as class names and not apply.
  return {
    baseTheme: undefined,
    variables: {
      colorBackground: "#ffffff",
      colorText: "#141618",
      colorTextSecondary: "#4a5568",
      colorInputBackground: "#ffffff",
      colorInputText: "#141618",
      colorPrimary: "#1a56db",
      colorNeutral: "#141618",
      colorDanger: "#c0392b",
      borderRadius: "4px",
      fontFamily: "Archivo, Inter, sans-serif",
      fontSize: "15px",
    },
    elements: {
      card: { background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", border: "1px solid #e2e5e9" },
      headerTitle: { color: "#141618", fontSize: "22px", fontWeight: 700 },
      headerSubtitle: { color: "#4a5568", fontSize: "14px" },
      formFieldLabel: { color: "#141618", fontSize: "13px", fontWeight: 500 },
      formFieldInput: { color: "#141618", background: "#ffffff", border: "1px solid #c8cdd4", borderRadius: "4px", fontSize: "14px" },
      formButtonPrimary: { background: "#1a56db", color: "#ffffff", fontWeight: 600, fontSize: "14px", borderRadius: "4px" },
      socialButtonsBlockButton: { border: "1px solid #e2e5e9", color: "#141618", background: "#ffffff", borderRadius: "4px", fontSize: "14px", fontWeight: 500 },
      socialButtonsBlockButtonText: { color: "#141618", fontWeight: 500 },
      footerActionLink: { color: "#1a56db", fontWeight: 500 },
      dividerLine: { background: "#e2e5e9" },
      dividerText: { color: "#8a9ab0", fontSize: "12px" },
      identityPreviewText: { color: "#141618" },
      formFieldInputShowPasswordButton: { color: "#4a5568" },
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
          <Logo context="signin" height={24} />
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
              {/* Full-page navigation to the marketing contact page. */}
              <a href="/contact/" style={{ color: "#1a4fd6", fontWeight: 700, textDecoration: "none" }}>
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
          <Route path="/projects/:projectId/settings" component={ProjectSettingsPage} />
          <Route path="/p/:projectId/governance" component={GovernancePage} />
          <Route path="/p/:projectId/board" component={ProjectBoard} />
          <Route path="/p/:projectId/runs" component={RunsPage} />
          <Route path="/p/:projectId/repositories" component={Repositories} />
          <Route path="/p/:projectId/repositories/:id" component={RepositoryDetail} />
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
          <Route path="/reports" component={ReportsPage} />
          <Route path="/reports/:tab" component={ReportsPage} />
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
