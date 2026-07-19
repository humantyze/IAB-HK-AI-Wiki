import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import WikiIndex from "@/pages/WikiIndex";
import WikiPage from "@/pages/WikiPage";

const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));
const SuperAdminLogin = lazy(() => import("@/pages/SuperAdminLogin"));
const SuperAdminDashboard = lazy(() => import("@/pages/SuperAdminDashboard"));
const QuizPage = lazy(() => import("@/pages/QuizPage"));

const queryClient = new QueryClient();

function RouteFallback() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center" style={{ fontFamily: "'Montserrat', sans-serif" }}>
      <div className="w-8 h-8 border-2 border-[#D63425]/20 border-t-[#D63425] rounded-full animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/" component={WikiIndex} />
        <Route path="/quiz" component={QuizPage} />
        <Route path="/wiki/:slug" component={WikiPage} />
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/super-admin/login" component={SuperAdminLogin} />
        <Route path="/super-admin" component={SuperAdminDashboard} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
