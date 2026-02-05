/**
 * Tailwind CSS Configuration for Clapboard
 *
 * Configures Tailwind for the Chrome extension's injected UI components.
 * Scoped to avoid conflicts with streaming site styles.
 */

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/content/**/*.{ts,tsx}",
    "./src/popup/**/*.{ts,tsx}",
    "./src/shared/**/*.{ts,tsx}",
  ],
  // Prefix all Tailwind classes to avoid conflicts with host page styles
  prefix: "cb-",
  theme: {
    extend: {
      colors: {
        // Clapboard brand colors
        primary: {
          50: "#fef3f2",
          100: "#fee4e2",
          200: "#ffcdc9",
          300: "#fda9a3",
          400: "#f97970",
          500: "#f04d42",
          600: "#dd3024",
          700: "#ba241a",
          800: "#99211a",
          900: "#7f221c",
          950: "#450d09",
        },
        // Neutral grays for UI
        surface: {
          DEFAULT: "#1a1a1a",
          light: "#2a2a2a",
          lighter: "#3a3a3a",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        overlay: "12px",
      },
      boxShadow: {
        overlay: "0 8px 32px rgba(0, 0, 0, 0.4)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
