import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useGlobalAuthReferral } from "@/hooks/useGlobalAuthReferral";
import { MaintenanceBanner, MaintenanceBlock } from "@/components/MaintenanceBanner";
import { AuditLoadingScreen } from "@/components/audit/AuditLoadingScreen";
import { AuditErrorBoundary } from "@/components/audit/AuditErrorBoundary";

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
const AdminAnalysisQueue = lazy(() => import("./pages/admin/AdminAnalysisQueue"));
const AdminQualityHours = lazy(() => import("./pages/admin/AdminQualityHours"));
const AdminTaskValidation = lazy(() => import("./pages/admin/AdminTaskValidation"));
const AdminInfrastructure = lazy(() => import("./pages/admin/AdminInfrastructure"));

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

// Audit pages
const AuditLayout = lazy(() => import("./components/audit/AuditLayout"));
const AuditLogin = lazy(() => import("./pages/audit/AuditLogin"));
const AuditHome = lazy(() => import("./pages/audit/AuditHome"));
const AuditCampaignSelect = lazy(() => import("./pages/audit/AuditCampaignSelect"));
const AuditAudioValidation = lazy(() => import("./pages/audit/AuditAudioValidation"));
const AuditAudioDetail = lazy(() => import("./pages/audit/AuditAudioDetail"));
const AuditAudioTranscription = lazy(() => import("./pages/audit/AuditAudioTranscription"));
const AuditVideoModule = lazy(() => import("./pages/audit/AuditVideoModule"));
const AuditPhotoModule = lazy(() => import("./pages/audit/AuditPhotoModule"));
const AuditSearch = lazy(() => import("./pages/audit/AuditSearch"));
const AuditSettings = lazy(() => import("./pages/audit/AuditSettings"));
const AuditHistory = lazy(() => import("./pages/audit/AuditHistory"));
const AuditCampaigns = lazy(() => import("./pages/audit/AuditCampaigns"));

// Data pages
const DataLogin = lazy(() => import("./pages/data/DataLogin"));
const DataLayout = lazy(() => import("./components/data/DataLayout"));
const DataHome = lazy(() => import("./pages/data/DataHome"));
const DataCampaignSelect = lazy(() => import("./pages/data/DataCampaignSelect"));
const DataAudioTask = lazy(() => import("./pages/data/DataAudioTask"));
const DataVideoTask = lazy(() => import("./pages/data/DataVideoTask"));
const DataProfile = lazy(() => import("./pages/data/DataProfile"));


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 30_000,
    },
  },
});

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
        <AuditErrorBoundary>
          <Suspense fallback={<AuditLoadingScreen />}>
            <Routes>
              {/* Portal routes (public-facing, root) */}
              <Route path="/auth" element={<PortalAuth />} />
              <Route path="/invite/:code" element={<InvitePage />} />
              <Route path="/c/:slug" element={<PrivateUpload />} />
              
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
                <Route path="analysis-queue" element={<AdminAnalysisQueue />} />
                <Route path="quality-hours" element={<AdminQualityHours />} />
                <Route path="task-validation" element={<AdminTaskValidation />} />
                <Route path="infrastructure" element={<AdminInfrastructure />} />
              </Route>

              {/* Audit login (standalone) */}
              <Route path="/audit/login" element={<AuditLogin />} />

              {/* Audit routes with sidebar layout */}
              <Route path="/audit" element={<AuditLayout />}>
                <Route index element={<AuditHome />} />
                <Route path="audio/validation" element={<AuditCampaignSelect />} />
                <Route path="audio/validation/:campaignId" element={<AuditAudioValidation />} />
                <Route path="audio/validation/:campaignId/:recordingId" element={<AuditAudioDetail />} />
                <Route path="audio/transcription" element={<AuditAudioTranscription />} />
                <Route path="audio" element={<AuditHome />} />
                <Route path="video" element={<AuditVideoModule />} />
                <Route path="photo" element={<AuditPhotoModule />} />
                <Route path="transcription" element={<AuditAudioTranscription />} />
                <Route path="campaigns" element={<AuditCampaigns />} />
                <Route path="search" element={<AuditSearch />} />
                <Route path="history" element={<AuditHistory />} />
                <Route path="settings" element={<AuditSettings />} />
              </Route>

              {/* Data contributor routes */}
              <Route path="/data/login" element={<DataLogin />} />
              <Route path="/data" element={<DataLayout />}>
                <Route index element={<DataHome />} />
                <Route path=":mediaType/campaigns" element={<DataCampaignSelect />} />
                <Route path=":mediaType/task/:campaignId" element={<DataAudioTask />} />
                <Route path="profile" element={<DataProfile />} />
              </Route>

              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuditErrorBoundary>
        </MaintenanceBlock>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
