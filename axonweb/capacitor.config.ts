import type { CapacitorConfig } from "@capacitor/cli";

// Live reload no aparelho real (fase 1.7 do plano da Play Store): apontar o
// WebView para o servidor de dev do Vite em vez dos arquivos empacotados.
// Só liga quando CAP_SERVER_URL está definida — assim o bloco `server.url`
// NUNCA entra num build de release, que é falha de segurança grave.
const devServerUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.axon.app",
  appName: "Axon",
  webDir: "dist",
  server: {
    androidScheme: "https",
    ...(devServerUrl ? { url: devServerUrl, cleartext: true } : {}),
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
