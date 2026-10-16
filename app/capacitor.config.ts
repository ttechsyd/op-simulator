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
      // no phoning home: releases come from our own github repo
      statsUrl: "",
      updateUrl: "",
    },
  },
};

export default config;
