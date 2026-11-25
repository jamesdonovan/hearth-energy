/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      colors: {
        ink: {
          950: "#07090c",
          900: "#0b0f14",
          850: "#10161e",
          800: "#151c25",
          700: "#1c2530",
          600: "#2a3544",
        },
        solar: { DEFAULT: "#f0b429", dim: "#c4921a", soft: "rgba(240,180,41,0.15)" },
        batt: { DEFAULT: "#3ddc97", dim: "#1faa6c", soft: "rgba(61,220,151,0.15)" },
        gridin: { DEFAULT: "#f07167", dim: "#c44b42", soft: "rgba(240,113,103,0.15)" },
        gridout: { DEFAULT: "#5b9cff", dim: "#3a74d4", soft: "rgba(91,156,255,0.15)" },
        house: { DEFAULT: "#c4b5fd", dim: "#8b7cc9", soft: "rgba(196,181,253,0.15)" },
        car: { DEFAULT: "#22d3ee", dim: "#0891b2", soft: "rgba(34,211,238,0.15)" },
      },
      boxShadow: {
        card: "0 0 0 1px rgba(255,255,255,0.06), 0 12px 40px rgba(0,0,0,0.35)",
        cardLight: "0 0 0 1px rgba(15,23,42,0.08), 0 12px 32px rgba(15,23,42,0.08)",
      },
    },
  },
  plugins: [],
};
