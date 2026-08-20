import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

import ScrollToTop from "../components/layout/ScrollToTop";

import LandingPage from "../pages/LandingPage";
import NativeEntry from "../pages/NativeEntry";

// Auth
import Login from "../pages/Login";
import Signup from "../pages/Signup";
import ForgotPassword from "../pages/ForgotPassword";
import ResetPassword from "../pages/ResetPassword";
import AuthCallback from "../pages/AuthCallback";
import DeepLinkHandler from "../components/auth/DeepLinkHandler";
import NativeShell from "../components/layout/NativeShell";

// Onboarding
import QuestionnaireIntro from "../pages/QuestionnaireIntro";
import Questionnaire from "../pages/Questionnaire";
import Analyzing from "../pages/Analyzing";
import Result from "../pages/Result";
import DashboardLoading from "../pages/DashboardLoading";
import AppLoading from "../pages/AppLoading";
import NotificationToastProvider from "../components/notifications/NotificationToastProvider";

// App
import Dashboard from "../pages/Dashboard";
import Chat from "../pages/Chat";
import ChatConversation from "../pages/ChatConversation";
import Planning from "../pages/Planning";
import Insights from "../pages/Insights";
import { RoutineDetailPage } from "../pages/Routines";
import Focus from "../pages/Focus";
import Profile from "../pages/Profile";
import Settings from "../pages/Settings";

// No app empacotado não existe servidor HTTP: os arquivos vêm do sistema de
// arquivos do aparelho, então a History API do BrowserRouter não funciona e
// "/dashboard" viraria uma tela branca. O HashRouter resolve isso no nativo,
// enquanto a web continua com URLs limpas. A detecção é em runtime, então um
// único `npm run build` serve as duas plataformas.
const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <Router>
      <ScrollToTop />

      <DeepLinkHandler />

      <NativeShell />

      <NotificationToastProvider />

      <Routes>
        {/* Public — no app instalado a landing não faz sentido: quem abre já
            escolheu o Axon. Vai direto para o dashboard ou para o login. */}
        <Route
          path="/"
          element={Capacitor.isNativePlatform() ? <NativeEntry /> : <LandingPage />}
        />

        {/* Auth */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Redirects para evitar erro caso algum link antigo ainda exista */}
        <Route
          path="/forgotpassword"
          element={<Navigate to="/forgot-password" replace />}
        />
        <Route
          path="/resetpassword"
          element={<Navigate to="/reset-password" replace />}
        />

        {/* Onboarding */}
        <Route path="/questionnaire-intro" element={<QuestionnaireIntro />} />
        <Route path="/questionnaire" element={<Questionnaire />} />
        <Route path="/analyzing" element={<Analyzing />} />
        <Route path="/result" element={<Result />} />
        <Route path="/app-loading" element={<AppLoading />} />
        <Route path="/dashboard-loading" element={<DashboardLoading />} />

        {/* App interno */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/chat/:chatId" element={<ChatConversation />} />
        <Route path="/planning" element={<Planning initialView="agenda" />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/rotinas" element={<Planning initialView="rotinas" />} />
        <Route path="/rotinas/:id" element={<RoutineDetailPage />} />
        <Route path="/objetivos" element={<Planning initialView="objetivos" />} />
        <Route path="/focus" element={<Focus />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
        

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}