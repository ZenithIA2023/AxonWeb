import os
from supabase import create_client, Client, ClientOptions

_url = os.environ["SUPABASE_URL"]
_service_key = os.environ["SUPABASE_SERVICE_KEY"]

# Cliente de DADOS: sempre service_role, NUNCA deve ser mutado por login.
# Usado em todas as operações .table() — bypassa RLS de propósito (o backend
# é a fronteira de segurança e já filtra por user_id explicitamente).
supabase: Client = create_client(_url, _service_key)

# Cliente de AUTH: instância separada, usada só para operações .auth.*
# (sign_up / sign_in_with_password / sign_in_with_id_token / get_user).
# Essas chamadas SETAM a sessão do cliente; mantê-las isoladas impede que o
# cliente de dados acima troque de service_role para o JWT do usuário — o que
# faria os inserts passarem a respeitar RLS e falharem em tabelas sem política
# de INSERT (ex.: notifications).
#
# auto_refresh_token=False / persist_session=False são OBRIGATÓRIOS aqui.
# Por padrão a lib guarda, DENTRO deste cliente (que é global e atende todos os
# requests), a sessão do último usuário que logou, e agenda um timer para
# renovar o token pouco antes de ele expirar. Esse timer rodava de hora em hora,
# madrugada afora, ROTACIONANDO o refresh token do usuário no servidor enquanto
# o aparelho dele seguia guardando o token antigo. Ao voltar ao app, o refresh
# ia com um token de geração vencida e o Supabase respondia
# `refresh_token_already_used` — o usuário caía no login mesmo tendo usado o app
# no dia anterior. Sem o timer, quem renova é o aparelho, ao abrir o app.
supabase_auth: Client = create_client(
    _url,
    _service_key,
    options=ClientOptions(auto_refresh_token=False, persist_session=False),
)
