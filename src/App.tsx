import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useGlobalAuthReferral } from "@/hooks/useGlobalAuthReferral";
import { MaintenanceBanner, MaintenanceBlock } from "@/components/MaintenanceBanner";

const AdminLayout = lazy(() => import("./components/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const Index = lazy(() => import("./pages/Index"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const Rooms = lazy(() => import("./pages/Rooms"));
const Room = lazy(() => import("./pages/Room"));
const Review = lazy(() => import("./pages/Review"));
const Transcript = lazy(() => import("./pages/Transcript"));
const NotFound = lazy(() => import("./pages/NotFound"));
const ReviewQueue = lazy(() => import("./pages/admin/ReviewQueue"));
const SocialArt = lazy(() => import("./pages/admin/SocialArt"));
const RoomsMonitor = lazy(() => import("./pages/admin/RoomsMonitor"));
const AdminFaq = lazy(() => import("./pages/admin/AdminFaq"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminMaintenance = lazy(() => import("./pages/admin/AdminMaintenance"));
const AdminAnnouncements = lazy(() => import("./pages/admin/AdminAnnouncements"));
const AdminReferralNetwork = lazy(() => import("./pages/admin/AdminReferralNetwork"));

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
const PrivateUpload = lazy(() => import("./pages/portal/PrivateUpload"));


const queryClient = new QueryClient();

function AppInner() {
  useGlobalAuthReferral();
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppInner />
        <MaintenanceBanner />
        <MaintenanceBlock>
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

            {/* Admin login (standalone, no layout) */}
            <Route path="/admin/login" element={<AdminLogin />} />

            {/* Admin routes with sidebar layout */}
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="recordings" element={<Index />} />
              <Route path="campaigns" element={<Campaigns />} />
              <Route path="rooms" element={<Rooms />} />
              <Route path="room/:roomId" element={<Room />} />
              <Route path="review" element={<Review />} />
              <Route path="review-queue" element={<ReviewQueue />} />
              <Route path="transcription" element={<Transcript />} />
              <Route path="social-art" element={<SocialArt />} />
              <Route path="rooms-monitor" element={<RoomsMonitor />} />
              <Route path="faq" element={<AdminFaq />} />
              <Route path="maintenance" element={<AdminMaintenance />} />
              <Route path="announcements" element={<AdminAnnouncements />} />
              <Route path="referral-network" element={<AdminReferralNetwork />} />
            </Route>

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        </MaintenanceBlock>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
