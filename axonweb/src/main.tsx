import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./app/App";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import "@fontsource-variable/inter/index.css";
import "./styles/index.css";

// Marca o documento quando rodando dentro do app. Todo o CSS de safe area e de
// comportamento nativo fica atrás desta classe, então a web segue idêntica.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add("is-native");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);