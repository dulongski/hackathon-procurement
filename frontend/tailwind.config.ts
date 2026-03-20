import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "ciq-red": "#FF0000",
        "ciq-darkgrey": "#333333",
        "ciq-white": "#E7E7E7",
        "ciq-black": "#000000",
      },
      fontFamily: {
        sans: ['"Visby CF"', "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
