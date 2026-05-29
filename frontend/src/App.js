import React, { useEffect, useState } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { CartProvider } from "./lib/cart";

import Nav from "./components/sections/Nav";
import Hero from "./components/sections/Hero";
import CategoryStrip from "./components/sections/CategoryStrip";
import ProductRail from "./components/sections/ProductRail";
import PromoStrip from "./components/sections/PromoStrip";
import FeaturedShops from "./components/sections/FeaturedShops";
import ShopOfTheWeek from "./components/sections/ShopOfTheWeek";
import WhyHandcrafted from "./components/sections/WhyHandcrafted";
import Process from "./components/sections/Process";
import ForMakers from "./components/sections/ForMakers";
import Reviews from "./components/sections/Reviews";
import CustomCTA from "./components/sections/CustomCTA";
import BetaSignupCTA from "./components/sections/BetaSignupCTA";
import BuiltByMakers from "./components/sections/BuiltByMakers";
import Footer from "./components/sections/Footer";
import SupportVeteransStrip from "./components/SupportVeteransStrip";

import ShopPage from "./pages/ShopPage";
import ProductDetail from "./pages/ProductDetail";
import MakersPage from "./pages/MakersPage";
import MakerDetail from "./pages/MakerDetail";
import ClipFeedPage from "./pages/ClipFeedPage";
import CustomOrderPage from "./pages/CustomOrderPage";
import ApplyPage from "./pages/ApplyPage";
import { JournalPage, JournalDetail } from "./pages/JournalPage";
import CartPage from "./pages/CartPage";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import MakerLogin from "./pages/MakerLogin";
import MakerVerify from "./pages/MakerVerify";
import MakerDashboard from "./pages/MakerDashboard";
import MakerJournalEditor from "./pages/MakerJournalEditor";
import MakerStripeReturn from "./pages/MakerStripeReturn";
import AdminLogin from "./pages/AdminLogin";
import AdminVerify from "./pages/AdminVerify";
import AdminDashboard from "./pages/AdminDashboard";
import WorkshopAnalyticsDashboard from "./pages/WorkshopAnalyticsDashboard";
import ContactPage from "./pages/ContactPage";
import PolicyPage from "./pages/PolicyPage";
import CommunityPage from "./pages/CommunityPage";
import { CommunityLogin, CommunityVerify, CommunityAuthCallback } from "./pages/CommunityAuth";
import BuyerMessagesPage from "./pages/BuyerMessagesPage";
import MakerListingEditor from "./pages/MakerListingEditor";
import BetaPage from "./pages/BetaPage";
import PressPage from "./pages/PressPage";
import SEOLandingPage from "./pages/SEOLandingPage";
import { SEO_LANDING_PAGES } from "./pages/seoLandingConfig";
import LandingPage from "./pages/LandingPage";
import GrowWithUs from "./pages/GrowWithUs";
import MakerStudio from "./pages/MakerStudio";
import KitPage from "./pages/KitPage";
import KitsGallery from "./pages/KitsGallery";
import Welcome from "./pages/Welcome";
import UpdatesPage from "./pages/UpdatesPage";
import SignInPage, { ForgotPasswordPage, ResetPasswordPage } from "./pages/SignInPage";
import TrackBriefPage from "./pages/TrackBriefPage";
import MakerBriefPrintPage from "./pages/MakerBriefPrintPage";
import MakerBillingRedirect from "./pages/MakerBillingRedirect";
import AIAssistant from "./components/AIAssistant";
import InstallPwaButton from "./components/InstallPwaButton";
import LiveChatWidget from "./components/LiveChatWidget";
import WelcomeBackToast from "./components/WelcomeBackToast";
import MaintenancePage from "./components/MaintenancePage";
import BetaBanner from "./components/BetaBanner";
import CNCEmblem from "./components/CNCEmblem";
import NewsletterSignup from "./components/NewsletterSignup";
import RecentShowcaseStrip from "./components/RecentShowcaseStrip";
import TopShowcaseStrip from "./components/TopShowcaseStrip";
import MakerOfTheWeekSpotlight from "./components/MakerOfTheWeekSpotlight";
import VelocityProofStrip from "./components/VelocityProofStrip";
import WhyWeExist from "./components/sections/WhyWeExist";
import BuiltInRealWorkshops from "./components/sections/BuiltInRealWorkshops";
import TrendingForumStrip from "./components/TrendingForumStrip";
import TrendingJournalRail from "./components/TrendingJournalRail";
import FeaturedBuildsRail from "./components/FeaturedBuildsRail";
import CinematicMomentsStrip from "./components/CinematicMomentsStrip";
import MeetTheMakers from "./components/MeetTheMakers";
import AiDiscoverySearch from "./components/AiDiscoverySearch";
import { Toaster } from "sonner";
import { trackPageview, captureAttribution } from "./lib/analytics";
import { useSiteSettings } from "./hooks/useSiteSettings";
import { useStructuredData } from "./lib/seo";

const Home = () => {
  useStructuredData({
    title: "Crafters Market — Artisan Marketplace · CNC Metal Art, Laser Art & Custom Handmade Goods USA",
    description: "Artisan marketplace for CNC metal art, CNC laser art, plasma-cut signs, and custom handmade goods — precision crafting by vetted CNC manufacturing shops across the USA. Shop direct, made-to-order, fair maker payouts.",
    url: "https://craftersmarket.org/",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
  });
  return (
    <>
      <SupportVeteransStrip />
      <Hero />
      <div className="cm-glow-divider" aria-hidden="true" />
      <FeaturedBuildsRail testId="home-featured-builds" />
      <div className="cm-glow-divider" aria-hidden="true" />
      <CinematicMomentsStrip testId="home-cinematic-moments" />
      <div className="cm-glow-divider" aria-hidden="true" />
      <AiDiscoverySearch testId="home-ai-discovery" />
      <VelocityProofStrip testId="home-velocity" />
      <div className="cm-glow-divider" aria-hidden="true" />
      <WhyWeExist testId="home-why-we-exist" />
      <div className="cm-glow-divider" aria-hidden="true" />
      <MeetTheMakers testId="home-meet-makers" />
      <ShopOfTheWeek />
      <CategoryStrip />
      <ProductRail title="Editor's Picks" eyebrow="◆ Featured" featured testId="rail-featured" />
      <PromoStrip />
      <ProductRail title="Wall Art We Love" eyebrow="◆ Wall Art" category="Wall Art" viewAllHref="/shop?category=Wall%20Art" testId="rail-wall-art" />
      <ProductRail title="Made-to-Order Signs" eyebrow="◆ Custom Signs" category="Custom Signs" viewAllHref="/shop?category=Custom%20Signs" testId="rail-signs" />
      <FeaturedShops />
      <ProductRail title="Plasma-Cut Originals" eyebrow="◆ Technique · Plasma" technique="PLASMA" viewAllHref="/shop" testId="rail-plasma" />
      <WhyHandcrafted />
      <Process />
      <ForMakers />
      <CNCEmblem />
      <Reviews />
      <TrendingJournalRail />
      <TopShowcaseStrip testId="home-top-showcase" />
      <MakerOfTheWeekSpotlight testId="home-maker-of-week" />
      <BuiltInRealWorkshops testId="home-real-workshops" />
      <RecentShowcaseStrip
        eyebrow="◆ From the community"
        title="Recently shared by buyers"
        testId="home-recent-showcase"
      />
      <TrendingForumStrip />
      <NewsletterSignup />
      <CustomCTA />
      <BetaSignupCTA />
      <BuiltByMakers />
    </>
  );
};

function ScrollTop() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    captureAttribution();
    // iter284 — Skip the auto-reset when returning to `/shop` AND the
    // saved scroll-memory entry matches the current URL filter state.
    // Lets the buyer come back from a product detail page to exactly
    // the row they left. ShopPage owns the actual restore inside its
    // own effect once products are loaded.
    let skip = false;
    try {
      if (pathname === "/shop") {
        const raw = sessionStorage.getItem("cm_shop_scroll_memory");
        if (raw) {
          const m = JSON.parse(raw);
          // Only skip when the saved entry was captured under the same
          // URL search params — otherwise filter changes get sticky.
          if (m && m.search === search) skip = true;
        }
      }
    } catch { /* corrupted entry — fall through to default reset */ }
    if (!skip) window.scrollTo(0, 0);
    trackPageview();
  }, [pathname, search]);
  return null;
}

// Routes that bypass maintenance mode so operators can flip the switch back.
const MAINT_BYPASS_PREFIXES = ["/admin", "/maker"];

function MaintenanceGate({ children }) {
  const settings = useSiteSettings();
  const { pathname } = useLocation();
  if (!settings) return children;
  const bypass = MAINT_BYPASS_PREFIXES.some((p) => pathname.startsWith(p));
  if (settings.maintenance_mode && !bypass) {
    return <MaintenancePage message={settings.maintenance_message} />;
  }
  return (
    <>
      {settings.beta_mode && <BetaBanner message={settings.beta_message} />}
      {children}
    </>
  );
}

// Renders a duplicate BetaBanner pinned to the bottom of the page (in
// normal flow, after <Footer />) when admin has flipped the beta switch on.
// Reads settings independently so it can sit as a sibling of Footer in the
// layout tree without being captured inside MaintenanceGate's children.
function BetaBannerBottom() {
  const settings = useSiteSettings();
  if (!settings?.beta_mode) return null;
  return <BetaBanner message={settings.beta_message} position="bottom" />;
}

function App() {
  return (
    <CartProvider>
      <BrowserRouter>
        <ScrollTop />
        <div className="App grain" data-testid="app-root">
          <MaintenanceGate>
            <Nav />
            <main>
              <Routes>                <Route path="/" element={<Home />} />
                <Route path="/shop" element={<ShopPage />} />
                <Route path="/shop/:slug" element={<ProductDetail />} />
                <Route path="/makers" element={<MakersPage />} />
                <Route path="/makers/:slug" element={<MakerDetail />} />
                <Route path="/clips" element={<ClipFeedPage />} />
                <Route path="/clips/:slug" element={<ClipFeedPage />} />
                {/* Short, shareable maker URL (iter153 Phase 2). Plus
                    subscribers can pick a custom slug; everyone else
                    uses their auto-generated maker slug. Both forms
                    resolve via the same MakerDetail page. */}
                <Route path="/m/:slug" element={<MakerDetail />} />
                <Route path="/custom-order" element={<CustomOrderPage />} />
                <Route path="/apply" element={<ApplyPage />} />
                <Route path="/beta" element={<BetaPage />} />
                <Route path="/founders" element={<BetaPage />} />
                <Route path="/founder" element={<Navigate to="/founders" replace />} />
                <Route path="/press" element={<PressPage />} />

                {/* SEO landing pages — keyword-targeted, single source of
                    truth in seoLandingConfig.js so we don't duplicate
                    route declarations per slug. */}
                {Object.entries(SEO_LANDING_PAGES).map(([slug, cfg]) => (
                  <Route key={slug} path={`/${slug}`} element={<SEOLandingPage config={cfg} />} />
                ))}
                {/* Marketing landing page — 3 aliased routes for A/B testing
                    ad copy/URL variants. All render the same component. */}
                <Route path="/launch" element={<LandingPage />} />
                <Route path="/makers-beta" element={<LandingPage />} />
                <Route path="/for-makers" element={<LandingPage />} />
                <Route path="/grow" element={<GrowWithUs />} />
                <Route path="/studio" element={<MakerStudio />} />
                <Route path="/kits" element={<KitsGallery />} />
                <Route path="/welcome" element={<Welcome />} />
                <Route path="/kits/:slug" element={<KitPage />} />
                <Route path="/updates" element={<UpdatesPage />} />
                <Route path="/whats-new" element={<UpdatesPage />} />
                <Route path="/journal" element={<JournalPage />} />
                <Route path="/journal/:slug" element={<JournalDetail />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/checkout/success" element={<CheckoutSuccess />} />
                <Route path="/maker/login" element={<MakerLogin />} />
                <Route path="/maker/verify" element={<MakerVerify />} />
                <Route path="/maker/dashboard" element={<MakerDashboard />} />
                <Route path="/maker/journal/new" element={<MakerJournalEditor />} />
                <Route path="/maker/billing" element={<MakerBillingRedirect />} />
                <Route path="/maker/briefs/:briefId/print" element={<MakerBriefPrintPage />} />
                <Route path="/maker/stripe/return" element={<MakerStripeReturn />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin/verify" element={<AdminVerify />} />
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
                <Route path="/admin/workshop-analytics" element={<WorkshopAnalyticsDashboard />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/track" element={<TrackBriefPage />} />
                <Route path="/track/:trackingNumber" element={<TrackBriefPage />} />
                <Route path="/policy" element={<PolicyPage />} />
                <Route path="/terms" element={<Navigate to="/policy#terms" replace />} />
                <Route path="/tos" element={<Navigate to="/policy#terms" replace />} />
                <Route path="/signin" element={<SignInPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/community" element={<CommunityPage />} />
                <Route path="/community/login" element={<CommunityLogin />} />
                <Route path="/community/verify" element={<CommunityVerify />} />
                <Route path="/community/auth/callback" element={<CommunityAuthCallback />} />
                <Route path="/messages" element={<BuyerMessagesPage />} />
                <Route path="/maker/listings/new" element={<MakerListingEditor />} />
                <Route path="/maker/listings/:slug/edit" element={<MakerListingEditor />} />
                <Route path="/maker/renewals" element={<Navigate to="/maker/dashboard?tab=renewals" replace />} />
              </Routes>
            </main>
            <Footer />
            <BetaBannerBottom />
            <AIAssistant />
          </MaintenanceGate>
        </div>
        <Toaster
          theme="dark"
          position="top-right"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "#0a0a0a",
              border: "1px solid #262626",
              color: "#e5e5e5",
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
              fontSize: "12px",
              borderRadius: 0,
            },
          }}
        />
        <InstallPwaButton />
        <LiveChatWidget />
        <WelcomeBackToast />
      </BrowserRouter>
    </CartProvider>
  );
}

export default App;
