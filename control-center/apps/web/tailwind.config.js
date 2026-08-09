// Semantic color tokens resolve to CSS variables (see src/styles.css) using the
// "R G B" channel form so Tailwind's opacity modifiers (e.g. bg-primary/90,
// border-border/40) keep working. Themes swap the variables, not these names.
const token = (name) => `rgb(var(${name}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: token("--color-background"),
        panel: token("--color-panel"),
        border: token("--color-border"),
        text: token("--color-text"),
        muted: token("--color-muted"),
        primary: token("--color-primary"),
        primaryForeground: token("--color-primary-foreground"),
        danger: token("--color-danger"),
        success: token("--color-success"),
        warning: token("--color-warning")
      }
    }
  },
  plugins: []
};
