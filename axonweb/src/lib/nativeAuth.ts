import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

/**
 * OAuth do Google no app Android.
 *
 * No navegador nada disso é usado: o fluxo continua sendo um `window.location`
 * comum. Dentro do app ele NÃO funcionaria — o Google recusa OAuth em WebView
 * embutido (`disallowed_useragent`), porque o app hospedeiro poderia ler a
 * senha digitada. A saída é abrir o Chrome de verdade (Custom Tab) e voltar
 * para o app por deep link.
 */

// Precisa casar com MOBILE_SCHEME no backend e com o intent-filter do
// AndroidManifest.xml.
const DEEP_LINK_SCHEME = "com.axon.app";

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Marca a origem do fluxo para o backend. Só o app se identifica; a web não
 * manda nada e o backend a trata como padrão.
 */
export function withPlatform(url: string): string {
  if (!isNative()) return url;
  return url + (url.includes("?") ? "&" : "?") + "platform=mobile";
}

/**
 * Abre uma URL de OAuth do jeito certo para cada plataforma.
 * Na web navega na própria aba (comportamento de sempre); no app abre o
 * navegador do sistema, de onde o Google aceita autenticar.
 *
 * `markPlatform` só vale para URLs do NOSSO backend, que entendem
 * `platform=mobile`. Para uma URL já pronta do Google (o `auth_url` do fluxo
 * "conectar agenda", onde a plataforma foi informada na chamada anterior),
 * passe `false` — acrescentar o parâmetro ali sujaria a URL do provedor.
 */
export async function openAuthUrl(
  url: string,
  { markPlatform = true }: { markPlatform?: boolean } = {}
): Promise<void> {
  const target = markPlatform ? withPlatform(url) : url;

  if (!isNative()) {
    window.location.href = target;
    return;
  }

  await Browser.open({ url: target });
}

/**
 * Converte o deep link de volta (`com.axon.app:///#/rota?query`) na rota interna
 * correspondente, ou null se a URL não for nossa.
 *
 * O backend já manda o caminho com "#" porque o app roda em HashRouter, então
 * o que interessa é tudo o que vem depois dele.
 */
export function deepLinkToRoute(url: string): string | null {
  if (!url.startsWith(`${DEEP_LINK_SCHEME}:`)) return null;

  const hashIndex = url.indexOf("#");
  if (hashIndex >= 0) {
    const route = url.slice(hashIndex + 1);
    return route.startsWith("/") ? route : `/${route}`;
  }

  // Sem "#" (deep link montado à mão): aproveita o que vier depois do host.
  const withoutScheme = url.slice(`${DEEP_LINK_SCHEME}:`.length).replace(/^\/+/, "");
  return withoutScheme ? `/${withoutScheme}` : null;
}

/**
 * Escuta os deep links de volta do OAuth e entrega a rota interna ao chamador.
 * Devolve uma função para cancelar a escuta.
 *
 * Fecha o Custom Tab antes de navegar: sem isso o Chrome fica por cima do app
 * e o usuário vê uma página em branco em vez da tela de destino.
 */
export function listenForAuthDeepLink(
  onRoute: (route: string) => void
): () => void {
  if (!isNative()) return () => {};

  const handle = App.addListener("appUrlOpen", async ({ url }) => {
    const route = deepLinkToRoute(url);
    if (!route) return;

    try {
      await Browser.close();
    } catch {
      // Em alguns aparelhos o Custom Tab já fechou sozinho ao disparar o deep
      // link; o erro daí é irrelevante e não pode impedir a navegação.
    }

    onRoute(route);
  });

  return () => {
    handle.then((h) => h.remove()).catch(() => {});
  };
}
