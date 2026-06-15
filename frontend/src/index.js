import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { ThemeProvider } from "@/components/ThemeProvider";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);

// iter413ae — Fade out the inline #cm-boot-loader once React's first
// frame has actually painted. requestAnimationFrame guarantees we run
// AFTER the browser composites the React tree, so there's never a flash
// of unstyled content between loader and app. Loader is removed from
// the DOM 350ms later (the CSS transition is 280ms — small buffer).
requestAnimationFrame(() => {
  document.body.classList.add("cm-booted");
  setTimeout(() => {
    const loader = document.getElementById("cm-boot-loader");
    if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
  }, 350);
});
