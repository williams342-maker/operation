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
import AdminLogin from "./pages/AdminLogin";
import AdminVerify from "./pages/AdminVerify";
import AdminDashboard from "./pages/AdminDashboard";
import ContactPage from "./pages/ContactPage";
import PolicyPage from "./pages/PolicyPage";
import CommunityPage from "./pages/CommunityPage";
import { CommunityLogin, CommunityVerify, CommunityAuthCallback } from "./pages/CommunityAuth";
import AIAssistant from "./components/AIAssistant";

const Home = () => (
  <>
    <Hero />
    <CategoryStrip />
    <ProductRail title="Editor's Picks" eyebrow="◆ Featured" testId="rail-featured" />
    <PromoStrip />
    <ProductRail title="Wall Art We Love" eyebrow="◆ Wall Art" category="Wall Art" viewAllHref="/shop?category=Wall%20Art" testId="rail-wall-art" />
    <ProductRail title="Made-to-Order Signs" eyebrow="◆ Custom Signs" category="Custom Signs" viewAllHref="/shop?category=Custom%20Signs" testId="rail-signs" />
    <FeaturedShops />
    <ProductRail title="Plasma-Cut Originals" eyebrow="◆ Technique · Plasma" technique="PLASMA" viewAllHref="/shop" testId="rail-plasma" />
    <Process />
    <ForMakers />
    <Reviews />
    <CustomCTA />
  </>
);

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function App() {
  return (
    <CartProvider>
      <BrowserRouter>
        <ScrollTop />
        <div className="App grain" data-testid="app-root">
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
        </div>
      </BrowserRouter>
    </CartProvider>
  );
}

export default App;
