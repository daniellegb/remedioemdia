
-- 1. Habilitar as extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Desagendar qualquer job legado de notificações
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-reminders-every-minute') THEN
        PERFORM cron.unschedule('send-reminders-every-minute');
    END IF;
END $$;

-- 3. Agendar o dispatcher oficial (send-notifications) para rodar a cada minuto
-- Substitua '<PROJECT_REF>' pelo ID do seu projeto Supabase (ex: zskhvpuamsblbghsqedf)
-- Substitua 'YOUR_SERVICE_ROLE_KEY' pela sua service_role key
SELECT cron.schedule(
  'send-notifications-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-notifications',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
  );
  $$
);


-- NOTA: Você deve substituir 'YOUR_SERVICE_ROLE_KEY' pela sua service_role key 
-- ou configurar a função como 'no-verify-jwt' no deploy.
-- O URL correto para funções do Supabase é https://<PROJECT_ID>.supabase.co/functions/v1/<FUNCTION_NAME>
