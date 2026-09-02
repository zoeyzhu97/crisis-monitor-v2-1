import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" 让构建产物可以部署在 GitHub Pages 的子路径下
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 3000, open: true },
});
