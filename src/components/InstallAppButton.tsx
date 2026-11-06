import { useEffect, useState } from "react";
import { Download } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isAppInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true);
}

export default function InstallAppButton() {
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

  if (installed) return null;

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
      <button className="button button-outline install-app-button" type="button" onClick={() => void install()} aria-label="Pasang aplikasi" title="Pasang aplikasi">
        <Download size={15} />
        <span>Pasang aplikasi</span>
      </button>
      {help && <p className="install-app-help" role="status">{help}</p>}
    </div>
  );
}
