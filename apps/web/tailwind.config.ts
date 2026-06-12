import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: "#f5f3ea",
        ink: "#14213d",
        ember: "#e76f51",
        lime: "#7ebc59",
        night: "#0f172a"
      },
      fontFamily: {
        display: ["'Bebas Neue'", "sans-serif"],
        body: ["'DM Sans'", "sans-serif"]
      },
      backgroundImage: {
        mesh: "radial-gradient(circle at 10% 20%, rgba(231,111,81,0.3), transparent 35%), radial-gradient(circle at 80% 10%, rgba(126,188,89,0.25), transparent 40%), linear-gradient(140deg, #f5f3ea, #fff9f2)"
      }
    }
  },
  plugins: []
};

export default config;
