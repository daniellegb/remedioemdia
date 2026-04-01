# Guia para Alteração de Chaves VAPID

Como as chaves VAPID vazaram, é necessário substituí-las em todos os ambientes. Siga este passo a passo para garantir que nada seja esquecido.

## 1. Gerar Novas Chaves
No seu terminal local, execute:
```bash
npx web-push generate-vapid-keys
```
Isso retornará um par de chaves: **Public Key** e **Private Key**.

## 2. Atualizar o Supabase (Backend)
As Edge Functions usam as chaves para assinar as notificações.

Execute os comandos abaixo usando a CLI do Supabase:
```bash
supabase secrets set VAPID_PUBLIC_KEY=SUA_NOVA_CHAVE_PUBLICA
supabase secrets set VAPID_PRIVATE_KEY=SUA_NOVA_CHAVE_PRIVADA
supabase secrets set VAPID_SUBJECT=mailto:seu-email@exemplo.com
```

## 3. Atualizar a Vercel (Frontend)
O frontend precisa da chave pública para registrar o Service Worker.

1. Acesse o Dashboard da **Vercel**.
2. Vá em **Settings** > **Environment Variables**.
3. Edite a variável `VITE_VAPID_PUBLIC_KEY` com a nova chave pública.
4. **Importante:** Você precisará fazer um novo Deploy para que a Vercel injete a nova chave no código.

## 4. Atualizar Ambiente Local
Edite seu arquivo `.env` local:
```env
VITE_VAPID_PUBLIC_KEY=SUA_NOVA_CHAVE_PUBLICA
```

## 5. Limpar Subscrições Antigas (Obrigatório)
**Atenção:** Quando você troca as chaves VAPID, todas as subscrições existentes nos navegadores dos usuários tornam-se inválidas (pois foram assinadas com a chave privada antiga).

Para evitar erros de "403 Forbidden" ou "410 Gone" nas Edge Functions, você deve limpar a tabela de subscrições no Supabase:

1. Vá ao **SQL Editor** do Supabase.
2. Execute:
```sql
TRUNCATE TABLE public.push_subscriptions;
```

## 6. Ação do Usuário
Os usuários precisarão entrar na tela de **Configurações** do aplicativo e reativar as notificações push. O aplicativo detectará que não há subscrição e solicitará a nova permissão usando a chave pública atualizada.

---
**Dica:** Guarde a chave privada em um local seguro (como o cofre de senhas da sua equipe) e nunca a envie para o GitHub.
