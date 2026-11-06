import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rgsunityhub.app",
  appName: "RGS Unity Hub",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert", "banner", "list"],
    },
  },
};

export default config;
