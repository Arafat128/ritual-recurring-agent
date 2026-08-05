import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        lime: "#c8ff4a",
        cyan: "#22d3ee",
      },
    },
  },
  plugins: [],
};
export default config;
