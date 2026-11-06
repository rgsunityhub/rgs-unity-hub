import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Capacitor } from "@capacitor/core";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isAppInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true);
}

export default function InstallAppButton() {
  const [nativeApp] = useState(Capacitor.isNativePlatform);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isAppInstalled);
  const [help, setHelp] = useState("");

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setHelp("");
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  if (nativeApp) return null;

  const install = async () => {
    if (!installPrompt) {
      setHelp((current) => current ? "" : "Pilih menu browser (⋮ atau Bagikan), lalu “Instal aplikasi” atau “Tambahkan ke Layar Utama”.");
      return;
    }

    const prompt = installPrompt;
    setInstallPrompt(null);
    setHelp("");
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
    } catch (error) {
      setHelp(error instanceof Error ? `Pemasangan gagal: ${error.message}` : "Pemasangan gagal. Coba melalui menu browser.");
    }
  };

  return (
    <div className="install-app">
      {!installed && (
        <button className="button button-outline install-app-button" type="button" onClick={() => void install()} aria-label="Pasang aplikasi" title="Pasang aplikasi">
          <Download size={15} />
          <span>Pasang aplikasi</span>
        </button>
      )}
      <a
        className="button button-outline android-apk-button"
        href="https://github.com/rgsunityhub/rgsunityhub.github.io/releases/latest/download/rgs-unity-hub.apk"
        download
        aria-label="Unduh APK Android"
        title="Unduh APK Android"
      >
        <Download size={15} />
        <span>Unduh APK Android</span>
      </a>
      {help && <p className="install-app-help" role="status">{help}</p>}
    </div>
  );
}
