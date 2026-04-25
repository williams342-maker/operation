import React, { useEffect, useState } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { CartProvider } from "./lib/cart";

import Nav from "./components/sections/Nav";
import Hero from "./components/sections/Hero";
import MakerShowcase from "./components/sections/MakerShowcase";
import Categories from "./components/sections/Categories";
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

const Home = () => (
  <>
    <Hero />
    <MakerShowcase />
    <Categories />
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
            </Routes>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </CartProvider>
  );
}

export default App;
