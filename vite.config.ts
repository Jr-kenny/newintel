import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  server: {
    port: 8080,
    // GenLayer web-oracle hits the relayer through a cloudflared tunnel.
    allowedHosts: true,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
    }),
    viteReact(),
    nitro({
      preset: "vercel",
      vercel: {
        functions: {
          maxDuration: 300,
          memory: 1024,
          runtime: "nodejs22.x",
        },
      },
    }),
  ],
});
