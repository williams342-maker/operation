import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Nav from "./components/sections/Nav";
import Hero from "./components/sections/Hero";
import MakerShowcase from "./components/sections/MakerShowcase";
import Categories from "./components/sections/Categories";
import Process from "./components/sections/Process";
import ForMakers from "./components/sections/ForMakers";
import Reviews from "./components/sections/Reviews";
import CustomCTA from "./components/sections/CustomCTA";
import Footer from "./components/sections/Footer";

const Home = () => (
  <div className="App grain" data-testid="home-page">
    <Nav />
    <main>
      <Hero />
      <MakerShowcase />
      <Categories />
      <Process />
      <ForMakers />
      <Reviews />
      <CustomCTA />
    </main>
    <Footer />
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
