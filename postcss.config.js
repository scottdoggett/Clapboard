/**
 * PostCSS Configuration
 *
 * Processes Tailwind CSS for the extension's UI components.
 */

/** @type {import('postcss').Config} */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
