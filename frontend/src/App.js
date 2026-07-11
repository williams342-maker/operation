import React, { useEffect, useState } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
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
import ApplicationVerifyPage from "./pages/ApplicationVerifyPage";
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
import LegacyPolicyRedirect from "./pages/LegacyPolicyRedirect";
import TrustCenterPage from "./pages/TrustCenterPage";
import TrustVendorsPage from "./pages/TrustVendorsPage";
import PoliciesIndexPage from "./pages/PoliciesIndexPage";
import CookiePreferences from "./pages/CookiePreferences";
import PolicyDetailPage from "./pages/PolicyDetailPage";
import PrintBundlePage from "./pages/PrintBundlePage";
import CommunityPage from "./pages/CommunityPage";
import CommunityEmblemPage from "./pages/CommunityEmblemPage"; // iter413bs
import AccountDeletePage from "./pages/AccountDeletePage"; // iter426 — Play compliance
import DataRequestPage from "./pages/DataRequestPage"; // iter426b — Play Data Safety partial-data request
import AppTestingPage from "./pages/AppTestingPage"; // iter428 — Beta app testing
import BetaSignupPage from "./pages/BetaSignupPage"; // iter433 — per-platform beta collection
import BetaFeedbackPage from "./pages/BetaFeedbackPage"; // iter435 — beta bug/feedback form
import BetaTestingHint from "./components/BetaTestingHint"; // iter428 — dismissible NEW pill
import CompassPreviewPage from "./pages/CompassPreviewPage"; // iter413ct+ — temporary brand-pick preview
import { CommunityLogin, CommunityVerify, CommunityAuthCallback } from "./pages/CommunityAuth";
import BuyerMessagesPage from "./pages/BuyerMessagesPage";
import MakerListingEditor from "./pages/MakerListingEditor";
import BetaPage from "./pages/BetaPage";
import PressPage from "./pages/PressPage";
import PricingPage from "./pages/PricingPage";
import SEOLandingPage from "./pages/SEOLandingPage";
import HowCustomOrdersWorkPage from "./pages/HowCustomOrdersWorkPage";
import FreeSvgPackPage from "./pages/FreeSvgPackPage";
import StatePage from "./pages/StatePage";
import GuidePage from "./pages/GuidePage";
import { SEO_LANDING_PAGES } from "./pages/seoLandingConfig";
import { GUIDES } from "./pages/guideConfig";
import LandingPage from "./pages/LandingPage";
import NotFoundPage from "./pages/NotFoundPage";
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
import HelpSupportWidget from "./components/HelpSupportWidget";
import InstallPwaButton from "./components/InstallPwaButton";
import LiveChatWidget from "./components/LiveChatWidget";
import WelcomeBackToast from "./components/WelcomeBackToast";
import CookieBanner from "./components/CookieBanner";
import MaintenancePage from "./components/MaintenancePage";
import BetaBanner from "./components/BetaBanner";
import ImpersonationBanner from "./components/ImpersonationBanner";
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
import TrendingMosaicStrip from "./components/TrendingMosaicStrip";
import CinematicMomentsStrip from "./components/CinematicMomentsStrip";
import MeetTheMakers from "./components/MeetTheMakers";
import AiDiscoverySearch from "./components/AiDiscoverySearch";
import SitePromo from "./components/SitePromo";
import { Toaster } from "sonner";
import { trackPageview, captureAttribution } from "./lib/analytics";
import { useSiteSettings } from "./hooks/useSiteSettings";
import { useStructuredData } from "./lib/seo";
import MobileStickyCTA from "./components/MobileStickyCTA";

const Home = () => {
  useStructuredData({
    title: "Crafters Market — Handmade Wood, Metal, Pottery & Leather Goods by US Makers",
    // iter411e — Trimmed from 239 → 140 chars (under Google's 160-char
    // SERP cutoff). Kept all 6 craft category keywords + trust signals
    // (vetted US makers, made-to-order, Stripe-secured).
    description: "Handmade pottery, jewelry, woodworking, leather, fiber & CNC metal art by vetted US makers. Made-to-order, ships nationwide. Stripe-secured.",
    url: "https://craftersmarket.org/",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
  });
  return (
    <>
      <SupportVeteransStrip />
      <SitePromo placement="home_hero" />
      <Hero />
      <div className="cm-glow-divider" aria-hidden="true" />
      <FeaturedBuildsRail testId="home-featured-builds" />
      <div className="cm-glow-divider" aria-hidden="true" />
      <TrendingMosaicStrip testId="home-trending-mosaic" />
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
      {/* iter386 — user request: surface more craft types on the homepage.
          Rails self-hide (return null) until their category has listings. */}
      <ProductRail title="Jewelry We Love" eyebrow="◆ Jewelry" category="Jewelry" viewAllHref="/shop?category=Jewelry" testId="rail-jewelry" />
      <ProductRail title="Woodwork & Furniture" eyebrow="◆ Woodworking" category="Furniture" viewAllHref="/shop?category=Furniture" testId="rail-woodwork" />
      <ProductRail title="Pottery & Ceramics" eyebrow="◆ Pottery" category="Pottery & Ceramics" viewAllHref="/shop?category=Pottery%20%26%20Ceramics" testId="rail-pottery" />
      <ProductRail title="Kitchen & Bar Craft" eyebrow="◆ Kitchen" category="Kitchen & Bar" viewAllHref="/shop?category=Kitchen%20%26%20Bar" testId="rail-kitchen" />
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
// normal flow, after <Footer />) when admin has flipped the Founding Access switch on.
// Reads settings independently so it can sit as a sibling of Footer in the
// layout tree without being captured inside MaintenanceGate's children.
function BetaBannerBottom() {
  const settings = useSiteSettings();
  if (!settings?.beta_mode) return null;
  return <BetaBanner message={settings.beta_message} position="bottom" />;
}

// iter320b — Crawler → real-browser handoff for showcase posts.
// The prerender at /api/og/showcase/<id> renders crawlable HTML and
// meta-refreshes a real browser to /community?showcase=<id>. The
// React Router route at /community/showcase/:postId hands off here
// so we redirect with the postId carried through as a query param,
// which CommunityPage's useEffect picks up to open the focused post.
function ShowcaseDeeplinkRedirect() {
  const { postId } = useParams();
  return <Navigate to={`/community?showcase=${encodeURIComponent(postId || "")}`} replace />;
}


function App() {
  return (
    <CartProvider>
      <BrowserRouter>
        <ScrollTop />
        <div className="App grain pb-14 md:pb-0" data-testid="app-root">
          <MaintenanceGate>
            <ImpersonationBanner />
            <Nav />
            <BetaTestingHint />
            <main>
              <Routes>                <Route path="/" element={<Home />} />
                <Route path="/shop" element={<ShopPage />} />
                <Route path="/shop/:slug" element={<ProductDetail />} />
                <Route path="/makers" element={<MakersPage />} />
                <Route path="/makers/:slug" element={<MakerDetail />} />
                {/* iter450 — Store Section landing pages (SEO-indexable) */}
                <Route path="/makers/:slug/:sectionSlug" element={<MakerDetail />} />
                <Route path="/clips" element={<ClipFeedPage />} />
                <Route path="/clips/:slug" element={<ClipFeedPage />} />
                {/* Short, shareable maker URL (iter153 Phase 2). Plus
                    subscribers can pick a custom slug; everyone else
                    uses their auto-generated maker slug. Both forms
                    resolve via the same MakerDetail page. */}
                <Route path="/m/:slug" element={<MakerDetail />} />
                <Route path="/custom-order" element={<CustomOrderPage />} />
                <Route path="/apply" element={<ApplyPage />} />
                <Route path="/apply/verify" element={<ApplicationVerifyPage />} />
                <Route path="/founders/verify" element={<ApplicationVerifyPage />} />
                <Route path="/beta" element={<BetaPage />} />
                <Route path="/founders" element={<BetaPage />} />
                <Route path="/founder" element={<Navigate to="/founders" replace />} />
                <Route path="/press" element={<PressPage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/pricing-vs-etsy" element={<Navigate to="/pricing" replace />} />
                <Route path="/pricing-vs-shopify" element={<Navigate to="/pricing" replace />} />
                <Route path="/pricing-vs-amazon-handmade" element={<Navigate to="/pricing" replace />} />

                {/* SEO landing pages — keyword-targeted, single source of
                    truth in seoLandingConfig.js so we don't duplicate
                    route declarations per slug. */}
                {Object.entries(SEO_LANDING_PAGES).map(([slug, cfg]) => (
                  <Route key={slug} path={`/${slug}`} element={<SEOLandingPage config={cfg} />} />
                ))}
                {/* Phase-3 SEO hub — "How custom orders work" content page
                    targeting transactional intent queries between the
                    landing pages and the /custom-order form. */}
                <Route path="/how-custom-orders-work" element={<HowCustomOrdersWorkPage />} />
                {/* Phase-4-C lead magnet (iter303) — free CNC starter pack
                    behind soft email gate. Page is publicly indexable;
                    only the ZIP requires email submission. */}
                <Route path="/free-svg-pack" element={<FreeSvgPackPage />} />
                {/* Phase-4 state pages (iter301) — only states with ≥ 1
                    maker render; backend filters the sitemap to match. */}
                <Route path="/makers/state/:code" element={<StatePage />} />
                {/* Phase-4 content guides (iter301) — long-form
                    educational content with HowTo + FAQPage schema. */}
                {Object.entries(GUIDES).map(([slug, cfg]) => (
                  <Route key={slug} path={`/guides/${slug}`} element={<GuidePage config={cfg} />} />
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
                <Route path="/policy" element={<LegacyPolicyRedirect />} />
                <Route path="/trust" element={<TrustCenterPage />} />
                <Route path="/trust/vendors" element={<TrustVendorsPage />} />
                <Route path="/policies" element={<PoliciesIndexPage />} />
                <Route path="/cookie-preferences" element={<CookiePreferences />} />
                <Route path="/policies/:slug" element={<PolicyDetailPage />} />
                <Route path="/counsel-packet" element={<PrintBundlePage />} />
                <Route path="/attorney-packet" element={<PrintBundlePage />} />
                <Route path="/terms" element={<Navigate to="/policies/terms" replace />} />
                <Route path="/tos" element={<Navigate to="/policies/terms" replace />} />
                <Route path="/signin" element={<SignInPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/community" element={<CommunityPage />} />
                {/* iter413bs — Interactive Garage Builders emblem (V2). */}
                <Route path="/community/emblem" element={<CommunityEmblemPage />} />
                <Route path="/admin/compass-preview" element={<CompassPreviewPage />} />
                <Route path="/community/showcase/:postId" element={<ShowcaseDeeplinkRedirect />} />
                <Route path="/community/login" element={<CommunityLogin />} />
                <Route path="/community/verify" element={<CommunityVerify />} />
                <Route path="/community/auth/callback" element={<CommunityAuthCallback />} />
                <Route path="/messages" element={<BuyerMessagesPage />} />
                {/* iter426 — Google Play Account Deletion compliance page */}
                <Route path="/account/delete" element={<AccountDeletePage />} />
                {/* iter426b — Play Data Safety: partial-data-deletion request */}
                <Route path="/account/data-request" element={<DataRequestPage />} />
                {/* iter428 — Beta app-testing landing page */}
                <Route path="/app-testing" element={<AppTestingPage />} />
                <Route path="/app-testing/android" element={<BetaSignupPage platform="android" />} />
                <Route path="/app-testing/ios" element={<BetaSignupPage platform="ios" />} />
                <Route path="/app-testing/feedback" element={<BetaFeedbackPage />} />
                <Route path="/maker/listings/new" element={<MakerListingEditor />} />
                <Route path="/maker/listings/:slug/edit" element={<MakerListingEditor />} />
                <Route path="/maker/renewals" element={<Navigate to="/maker/dashboard?tab=renewals" replace />} />
                {/* iter413by — Legacy / bookmarked URL aliases. Makers who
                    saved an old "account" or "dashboard" URL (or who
                    follow a stale email link) get bounced to their
                    proper destination instead of dead-ending on 404. */}
                <Route path="/account"          element={<Navigate to="/maker/dashboard" replace />} />
                <Route path="/dashboard"        element={<Navigate to="/maker/dashboard" replace />} />
                <Route path="/profile"          element={<Navigate to="/maker/dashboard?tab=settings" replace />} />
                <Route path="/maker"            element={<Navigate to="/maker/dashboard" replace />} />
                <Route path="/maker/account"    element={<Navigate to="/maker/dashboard" replace />} />
                <Route path="/maker/profile"    element={<Navigate to="/maker/dashboard?tab=settings" replace />} />
                <Route path="/maker/settings"   element={<Navigate to="/maker/dashboard?tab=settings" replace />} />
                <Route path="/maker/orders"     element={<Navigate to="/maker/dashboard?tab=orders" replace />} />
                <Route path="/maker/listings"   element={<Navigate to="/maker/dashboard?tab=listings" replace />} />
                <Route path="/maker/messages"   element={<Navigate to="/maker/dashboard?tab=messages" replace />} />
                {/* iter372 — catch-all 404 with noindex (soft-404 hygiene) */}
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </main>
            <Footer />
            <BetaBannerBottom />
            <AIAssistant />
            <HelpSupportWidget />
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
        {/* iter334e — GDPR cookie banner. Self-gates display: only
            renders when no valid consent record exists in localStorage,
            and re-opens via the `cm:reopen-cookie-banner` event fired
            from the Footer "Cookie preferences" link. */}
        <CookieBanner />
        <MobileStickyCTA />
      </BrowserRouter>
    </CartProvider>
  );
}

export default App;
