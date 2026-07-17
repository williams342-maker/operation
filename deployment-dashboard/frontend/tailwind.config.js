/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(220 13% 18%)",
        background: "hsl(222 47% 7%)",
        panel: "hsl(222 35% 10%)",
        muted: "hsl(220 18% 18%)",
        foreground: "hsl(213 31% 91%)",
        subdued: "hsl(215 16% 63%)",
        primary: "hsl(173 80% 42%)",
        danger: "hsl(0 74% 58%)",
        warning: "hsl(38 92% 50%)",
        success: "hsl(142 70% 45%)"
      }
    }
  },
  plugins: []
};
