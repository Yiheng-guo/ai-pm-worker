import { build } from "vite";
import react from "@vitejs/plugin-react";
import { rename } from "node:fs/promises";
await build({
  configFile: false,
  plugins: [react()],
  base: "./",
  publicDir: false,
  build: {
    outDir: "docs/personal",
    emptyOutDir: true,
    rolldownOptions: { input: "personal-demo.html" },
  },
});
await rename("docs/personal/personal-demo.html", "docs/personal/index.html");
