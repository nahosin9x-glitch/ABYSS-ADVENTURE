import type { CapacitorConfig } from "@capacitor/cli";
export default {
  appId: "com.nah.abyssadventure",
  appName: "Abyss Adventure",
  webDir: "dist",
  android: { backgroundColor: "#15131a" },
  server: { androidScheme: "https" },
} satisfies CapacitorConfig;
