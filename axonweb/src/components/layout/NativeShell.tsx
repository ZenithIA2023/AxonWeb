import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { initBackButton } from "../../lib/nativeBack";

/**
 * Comportamentos nativos que precisam viver dentro do Router.
 *
 * Hoje: o botão físico de voltar do Android, com o aviso "toque de novo para
 * sair" quando o usuário está numa tela raiz. Na web o listener nem é criado.
 */
export default function NativeShell() {
  const [avisoSaida, setAvisoSaida] = useState(false);

  useEffect(() => {
    return initBackButton(() => {
      setAvisoSaida(true);
      window.setTimeout(() => setAvisoSaida(false), 2000);
    });
  }, []);

  return (
    <AnimatePresence>
      {avisoSaida && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.18 }}
          className="pointer-events-none fixed inset-x-0 bottom-16 z-[200] flex justify-center px-6"
        >
          <span className="rounded-full bg-black/78 px-4 py-2 text-xs font-medium text-white backdrop-blur-sm">
            Toque em voltar de novo para sair
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
