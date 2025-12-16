import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: "#0F172A",
                secondary: "#1E293B",
                accent: "#38BDF8",
            },
        },
    },
    plugins: [],
};
export default config;
