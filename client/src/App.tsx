import { Switch, Route, useLocation, useRoute, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import Dashboard from "@/pages/Dashboard";
import ProjectDetails from "@/pages/ProjectDetails";
import ProjectAccess from "@/pages/ProjectAccess";
import ReportEditor from "@/pages/ReportEditor";
import Templates from "@/pages/Templates";
import CaptureManager from "@/pages/CaptureManager";
import CaptureCanvas from "@/pages/CaptureCanvas";
import LandingPage from "@/pages/LandingPage";
import Settings from "@/pages/Settings";
import Profile from "@/pages/Profile";
import Team from "@/pages/Team";
import Admin from "@/pages/Admin";
import Billing from "@/pages/Billing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Contact from "@/pages/Contact";
import Quotations from "@/pages/Quotations";
import QuotationEditor from "@/pages/QuotationEditor";
import NotFound from "@/pages/not-found";
import { OfflineBanner } from "@/components/OfflineBanner";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import SharedPortal from "@/pages/SharedPortal";
import { Loader2 } from "lucide-react";

function ProtectedRoute({
  component: Component,
}: {
  component: React.ComponentType;
}) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }
  if (!user) return <Redirect to="/login" />;
  return <Component />;
}

function PublicRoute({
  component: Component,
}: {
  component: React.ComponentType;
}) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }
  if (user) return <Redirect to="/dashboard" />;
  return <Component />;
}

function ProjectLandingRedirect() {
  const [, params] = useRoute("/project/:id");
  return <Redirect to={`/project/${params?.id}/captures`} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/">
        <PublicRoute component={LandingPage} />
      </Route>
      <Route path="/home" component={LandingPage} />
      <Route path="/contact" component={Contact} />
      <Route path="/login">
        <PublicRoute component={Login} />
      </Route>
      <Route path="/register">
        <PublicRoute component={Register} />
      </Route>
      <Route path="/dashboard">
        <ProtectedRoute component={Dashboard} />
      </Route>
      <Route path="/templates">
        <ProtectedRoute component={Templates} />
      </Route>
      <Route path="/settings">
        <ProtectedRoute component={Settings} />
      </Route>
      <Route path="/profile">
        <ProtectedRoute component={Profile} />
      </Route>
      <Route path="/team">
        <ProtectedRoute component={Team} />
      </Route>
      <Route path="/admin">
        <ProtectedRoute component={Admin} />
      </Route>
      <Route path="/billing">
        <ProtectedRoute component={Billing} />
      </Route>
      <Route path="/quotations">
        <ProtectedRoute component={Quotations} />
      </Route>
      <Route path="/project/:id/quotations">
        <ProtectedRoute component={Quotations} />
      </Route>
      <Route path="/quotation/:id">
        <ProtectedRoute component={QuotationEditor} />
      </Route>
      <Route path="/project/:id/reports">
        <ProtectedRoute component={ProjectDetails} />
      </Route>
      <Route path="/project/:id/team">
        <ProtectedRoute component={ProjectAccess} />
      </Route>
      <Route path="/project/:id">
        <ProjectLandingRedirect />
      </Route>
      <Route path="/project/:id/captures">
        <ProtectedRoute component={CaptureManager} />
      </Route>
      <Route path="/project/:projectId/captures/:captureId">
        <ProtectedRoute component={CaptureCanvas} />
      </Route>
      <Route path="/project/:projectId/floor-plans/:floorPlanId">
        <ProtectedRoute component={CaptureCanvas} />
      </Route>
      <Route path="/report/:id">
        <ProtectedRoute component={ReportEditor} />
      </Route>
      <Route path="/shared/:token" component={SharedPortal} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <OfflineBanner />
          <UpdatePrompt />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
