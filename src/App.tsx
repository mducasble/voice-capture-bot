import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";

const Campaigns = lazy(() => import("./pages/Campaigns"));
const Rooms = lazy(() => import("./pages/Rooms"));
const Room = lazy(() => import("./pages/Room"));
const Review = lazy(() => import("./pages/Review"));
const Transcript = lazy(() => import("./pages/Transcript"));
const NotFound = lazy(() => import("./pages/NotFound"));
const ReviewQueue = lazy(() => import("./pages/admin/ReviewQueue"));

// Portal pages
const PortalAuth = lazy(() => import("./pages/portal/PortalAuth"));
const PortalLayout = lazy(() => import("./components/portal/PortalLayout"));
const PortalDashboard = lazy(() => import("./pages/portal/PortalDashboard"));
const PortalCampaign = lazy(() => import("./pages/portal/PortalCampaign"));
const PortalCampaignTask = lazy(() => import("./pages/portal/PortalCampaignTask"));
const PortalMyCampaigns = lazy(() => import("./pages/portal/PortalMyCampaigns"));
const PortalProfile = lazy(() => import("./pages/portal/PortalProfile"));
const PortalEarnings = lazy(() => import("./pages/portal/PortalEarnings"));
const InvitePage = lazy(() => import("./pages/portal/InvitePage"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<div className="min-h-screen bg-background" />}>
          <Routes>
            {/* Portal routes (public-facing, root) */}
            <Route path="/auth" element={<PortalAuth />} />
            <Route path="/invite/:code" element={<InvitePage />} />
            <Route path="/" element={<PortalLayout />}>
              <Route index element={<PortalDashboard />} />
              <Route path="campaign/:id" element={<PortalCampaign />} />
              <Route path="campaign/:id/task" element={<PortalCampaignTask />} />
              <Route path="my-campaigns" element={<PortalMyCampaigns />} />
              <Route path="earnings" element={<PortalEarnings />} />
              <Route path="profile" element={<PortalProfile />} />
              <Route path="room/:roomId" element={<Room />} />
            </Route>

            {/* Admin routes */}
            <Route path="/admin" element={<Index />} />
            <Route path="/admin/campaigns" element={<Campaigns />} />
            <Route path="/admin/rooms" element={<Rooms />} />
            <Route path="/admin/room/:roomId" element={<Room />} />
            <Route path="/admin/review" element={<Review />} />
            <Route path="/admin/review-queue" element={<ReviewQueue />} />
            <Route path="/admin/transcription" element={<Transcript />} />

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
