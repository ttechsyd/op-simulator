import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.opsim.app",
  appName: "OP Sim",
  webDir: "dist",
  android: {
    backgroundColor: "#15202b",
  },
  plugins: {
    CapacitorUpdater: {
      // we drive updates ourselves from the menu
      autoUpdate: false,
      resetWhenUpdate: true,
    },
  },
};

export default config;
