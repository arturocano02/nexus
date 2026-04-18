import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        amber: {
          DEFAULT: "#FFBF00",
          glow: "#FFD24C",
          deep: "#B88800",
        },
        cyan: {
          DEFAULT: "#00DCFF",
          glow: "#7FEFFF",
          deep: "#007A8F",
        },
        navy: {
          DEFAULT: "#000033",
          800: "#050526",
          700: "#0A0A40",
          600: "#141466",
        },
        secondary: "#F5F5F5",
      },
      fontFamily: {
        display: ["var(--font-jakarta)", "system-ui", "sans-serif"],
        body: ["var(--font-manrope)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        "2xl": "1.25rem",
        "3xl": "1.75rem",
        pill: "999px",
      },
      boxShadow: {
        amber: "0 0 40px -8px rgba(255,191,0,0.55)",
        cyan: "0 0 40px -8px rgba(0,220,255,0.55)",
        card: "0 10px 40px -20px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.04) inset",
      },
      keyframes: {
        pulseGlow: {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(255,191,0,0.55)" },
          "50%": { boxShadow: "0 0 0 14px rgba(255,191,0,0)" },
        },
        slideUp: {
          from: { transform: "translateY(12%)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        rollDown: {
          from: { transform: "translateY(-100%)" },
          to: { transform: "translateY(0)" },
        },
      },
      animation: {
        pulseGlow: "pulseGlow 2.2s ease-in-out infinite",
        slideUp: "slideUp 300ms cubic-bezier(0.22,1,0.36,1)",
        rollDown: "rollDown 450ms cubic-bezier(0.22,1,0.36,1)",
      },
    },
  },
  plugins: [],
};

export default config;
