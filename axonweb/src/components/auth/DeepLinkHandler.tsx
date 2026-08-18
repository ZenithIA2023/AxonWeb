import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { listenForAuthDeepLink } from "../../lib/nativeAuth";

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

  return null;
}
