
-- 1. Habilitar a extensão pg_cron se ainda não estiver habilitada
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Habilitar a extensão pg_net para chamadas HTTP
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 3. Agendar a função para rodar a cada minuto
-- Substitua 'SEU_PROJECT' pelo ID do seu projeto Supabase
SELECT cron.schedule(
  'send-notifications-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://zugmjotqqoineafwzkpf.supabase.co/functions/v1/send-notifications',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'
  );
  $$
);

-- NOTA: Você deve substituir 'YOUR_SERVICE_ROLE_KEY' pela sua service_role key 
-- ou configurar a função como 'no-verify-jwt' no deploy.
-- O URL correto para funções do Supabase é https://<PROJECT_ID>.supabase.co/functions/v1/<FUNCTION_NAME>
