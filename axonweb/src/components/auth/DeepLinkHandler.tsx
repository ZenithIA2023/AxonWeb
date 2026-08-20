import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { listenForAuthDeepLink } from "../../lib/nativeAuth";
import { initPushListeners } from "../../lib/push";

/**
 * Traz o app de volta ao lugar certo quando o Android o reabre por deep link
 * (`com.axon.app:///#/auth/callback?session_code=...`), que é como o OAuth do
 * Google retorna no app.
 *
 * Precisa ficar DENTRO do Router para poder navegar. Na web não faz nada — lá
 * o retorno do OAuth é uma navegação normal do navegador.
 */
export default function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    // `replace` para que o botão voltar não caia de novo no callback, que é uma
    // rota de passagem e já consumiu seu código de uso único.
    return listenForAuthDeepLink((route) => navigate(route, { replace: true }));
  }, [navigate]);

  // Tocar numa notificação do sistema abre o app na tela correspondente. O
  // `type` vem do backend junto com o push (é o tipo da notificação).
  useEffect(() => {
    initPushListeners((data) => {
      const tipo = String(data.type ?? "");
      const ehPlanejamento = tipo === "planning_daily" || tipo === "planning_weekly";

      // Sugestões e mudanças são resolvidas no Dashboard (é lá que o card e o
      // toast aparecem); lembretes de planejamento levam direto ao Planning.
      navigate(ehPlanejamento ? "/planning" : "/dashboard");
    });
  }, [navigate]);

  return null;
}
