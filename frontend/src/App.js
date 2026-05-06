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
import Process from "./components/sections/Process";
import ForMakers from "./components/sections/ForMakers";
import Reviews from "./components/sections/Reviews";
import CustomCTA from "./components/sections/CustomCTA";
import Footer from "./components/sections/Footer";
import SupportVeteransStrip from "./components/SupportVeteransStrip";

import ShopPage from "./pages/ShopPage";
import ProductDetail from "./pages/ProductDetail";
import MakersPage from "./pages/MakersPage";
import MakerDetail from "./pages/MakerDetail";
import CustomOrderPage from "./pages/CustomOrderPage";
import ApplyPage from "./pages/ApplyPage";
import { JournalPage, JournalDetail } from "./pages/JournalPage";
import CartPage from "./pages/CartPage";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import MakerLogin from "./pages/MakerLogin";
import MakerVerify from "./pages/MakerVerify";
import MakerDashboard from "./pages/MakerDashboard";
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
import LandingPage from "./pages/LandingPage";
import UpdatesPage from "./pages/UpdatesPage";
import SignInPage, { ForgotPasswordPage, ResetPasswordPage } from "./pages/SignInPage";
import TrackBriefPage from "./pages/TrackBriefPage";
import MakerBriefPrintPage from "./pages/MakerBriefPrintPage";
import MakerBillingRedirect from "./pages/MakerBillingRedirect";
import AIAssistant from "./components/AIAssistant";
import InstallPwaButton from "./components/InstallPwaButton";
import LiveChatWidget from "./components/LiveChatWidget";
import MaintenancePage from "./components/MaintenancePage";
import BetaBanner from "./components/BetaBanner";
import CNCEmblem from "./components/CNCEmblem";
import NewsletterSignup from "./components/NewsletterSignup";
import RecentShowcaseStrip from "./components/RecentShowcaseStrip";
import TrendingForumStrip from "./components/TrendingForumStrip";
import { Toaster } from "sonner";
import { trackPageview, captureAttribution } from "./lib/analytics";
import { useSiteSettings } from "./hooks/useSiteSettings";
import { useStructuredData } from "./lib/seo";

const Home = () => {
  useStructuredData({
    title: "Crafters Market — Precision CNC Art & Handcrafted Goods",
    description: "Shop hand-built metal & wood CNC art, custom signs, and made-to-order pieces from approved independent makers. Stripe-secured checkout, direct-to-maker payouts.",
    url: "https://craftersmarket.org/",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
  });
  return (
    <>
      <SupportVeteransStrip />
      <Hero />
      <ShopOfTheWeek />
      <CategoryStrip />
      <ProductRail title="Editor's Picks" eyebrow="◆ Featured" featured testId="rail-featured" />
      <PromoStrip />
      <ProductRail title="Wall Art We Love" eyebrow="◆ Wall Art" category="Wall Art" viewAllHref="/shop?category=Wall%20Art" testId="rail-wall-art" />
      <ProductRail title="Made-to-Order Signs" eyebrow="◆ Custom Signs" category="Custom Signs" viewAllHref="/shop?category=Custom%20Signs" testId="rail-signs" />
      <FeaturedShops />
      <ProductRail title="Plasma-Cut Originals" eyebrow="◆ Technique · Plasma" technique="PLASMA" viewAllHref="/shop" testId="rail-plasma" />
      <Process />
      <ForMakers />
      <CNCEmblem />
      <Reviews />
      <RecentShowcaseStrip
        eyebrow="◆ From the community"
        title="Recently shared by buyers"
        testId="home-recent-showcase"
      />
      <TrendingForumStrip />
      <NewsletterSignup />
      <CustomCTA />
    </>
  );
};

function ScrollTop() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    captureAttribution();
    window.scrollTo(0, 0);
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
                <Route path="/custom-order" element={<CustomOrderPage />} />
                <Route path="/apply" element={<ApplyPage />} />
                <Route path="/beta" element={<BetaPage />} />
                {/* Marketing landing page — 3 aliased routes for A/B testing
                    ad copy/URL variants. All render the same component. */}
                <Route path="/launch" element={<LandingPage />} />
                <Route path="/makers-beta" element={<LandingPage />} />
                <Route path="/for-makers" element={<LandingPage />} />
                <Route path="/updates" element={<UpdatesPage />} />
                <Route path="/whats-new" element={<UpdatesPage />} />
                <Route path="/journal" element={<JournalPage />} />
                <Route path="/journal/:slug" element={<JournalDetail />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/checkout/success" element={<CheckoutSuccess />} />
                <Route path="/maker/login" element={<MakerLogin />} />
                <Route path="/maker/verify" element={<MakerVerify />} />
                <Route path="/maker/dashboard" element={<MakerDashboard />} />
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
      </BrowserRouter>
    </CartProvider>
  );
}

export default App;
