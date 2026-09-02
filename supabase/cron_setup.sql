
-- 1. Habilitar as extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS vault;

-- 2. Desagendar qualquer job legado/anterior de notificações
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-reminders-every-minute') THEN
        PERFORM cron.unschedule('send-reminders-every-minute');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-notifications-every-minute') THEN
        PERFORM cron.unschedule('send-notifications-every-minute');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-notifications-hourly') THEN
        PERFORM cron.unschedule('send-notifications-hourly');
    END IF;
END $$;

-- 3. Agendar o dispatcher oficial (send-notifications) para rodar a cada hora (no minuto 0)
-- O CRON_SECRET é lido dinamicamente do Supabase Vault (vault.decrypted_secrets)
-- Substitua '<PROJECT_REF>' pelo ID do seu projeto Supabase (ex: zskhvpuamsblbghsqedf)
SELECT cron.schedule(
  'send-notifications-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    )
  );
  $$
);

-- NOTA: O CRON_SECRET deve estar previamente cadastrado no Vault através do comando:
-- SELECT vault.create_secret('seu_cron_secret_aqui', 'CRON_SECRET');
-- A Edge Function send-notifications lê a secret de ambiente CRON_SECRET e aceita o header x-cron-secret (verify_jwt = false).

