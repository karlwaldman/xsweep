/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}", "./entrypoints/**/*.html"],
  theme: {
    extend: {
      colors: {
        x: {
          bg: "#000000",
          card: "#16181c",
          border: "#2f3336",
          text: "#e7e9ea",
          "text-secondary": "#71767b",
          accent: "#1d9bf0",
          "accent-hover": "#1a8cd8",
          green: "#00ba7c",
          red: "#f4212e",
          orange: "#ff7a00",
          yellow: "#ffd400",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
