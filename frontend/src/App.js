import React, { useEffect, useState } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
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
import ContactPage from "./pages/ContactPage";
import PolicyPage from "./pages/PolicyPage";
import CommunityPage from "./pages/CommunityPage";
import { CommunityLogin, CommunityVerify, CommunityAuthCallback } from "./pages/CommunityAuth";
import AIAssistant from "./components/AIAssistant";
import MaintenancePage from "./components/MaintenancePage";
import BetaBanner from "./components/BetaBanner";
import CNCEmblem from "./components/CNCEmblem";
import { Toaster } from "sonner";
import { trackPageview, captureAttribution } from "./lib/analytics";
import { useSiteSettings } from "./hooks/useSiteSettings";

const Home = () => (
  <>
    <Hero />
    <ShopOfTheWeek />
    <CategoryStrip />
    <ProductRail title="Editor's Picks" eyebrow="◆ Featured" testId="rail-featured" />
    <PromoStrip />
    <ProductRail title="Wall Art We Love" eyebrow="◆ Wall Art" category="Wall Art" viewAllHref="/shop?category=Wall%20Art" testId="rail-wall-art" />
    <ProductRail title="Made-to-Order Signs" eyebrow="◆ Custom Signs" category="Custom Signs" viewAllHref="/shop?category=Custom%20Signs" testId="rail-signs" />
    <FeaturedShops />
    <ProductRail title="Plasma-Cut Originals" eyebrow="◆ Technique · Plasma" technique="PLASMA" viewAllHref="/shop" testId="rail-plasma" />
    <Process />
    <ForMakers />
    <CNCEmblem />
    <Reviews />
    <CustomCTA />
  </>
);

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

function App() {
  return (
    <CartProvider>
      <BrowserRouter>
        <ScrollTop />
        <div className="App grain" data-testid="app-root">
          <MaintenanceGate>
            <Nav />
            <main>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/shop" element={<ShopPage />} />
                <Route path="/shop/:slug" element={<ProductDetail />} />
                <Route path="/makers" element={<MakersPage />} />
                <Route path="/makers/:slug" element={<MakerDetail />} />
                <Route path="/custom-order" element={<CustomOrderPage />} />
                <Route path="/apply" element={<ApplyPage />} />
                <Route path="/journal" element={<JournalPage />} />
                <Route path="/journal/:slug" element={<JournalDetail />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/checkout/success" element={<CheckoutSuccess />} />
                <Route path="/maker/login" element={<MakerLogin />} />
                <Route path="/maker/verify" element={<MakerVerify />} />
                <Route path="/maker/dashboard" element={<MakerDashboard />} />
                <Route path="/maker/stripe/return" element={<MakerStripeReturn />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin/verify" element={<AdminVerify />} />
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/policy" element={<PolicyPage />} />
                <Route path="/community" element={<CommunityPage />} />
                <Route path="/community/login" element={<CommunityLogin />} />
                <Route path="/community/verify" element={<CommunityVerify />} />
                <Route path="/community/auth/callback" element={<CommunityAuthCallback />} />
              </Routes>
            </main>
            <Footer />
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
      </BrowserRouter>
    </CartProvider>
  );
}

export default App;
