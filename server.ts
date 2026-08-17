import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

// Import Stripe server handlers
import checkoutHandler from './api/stripe/checkout.js';
import portalHandler from './api/stripe/create-portal-session.js';
import syncHandler from './api/stripe/sync-subscription.js';
import webhookHandler from './api/stripe/webhook.js';

// Helper functions to safely handle mismatched Supabase environment variables
function getProjectRefFromKey(key: string): string | null {
  try {
    const parts = key.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      return payload.ref || null;
    }
  } catch (e) {
    // Ignore decoding errors
  }
  return null;
}

function getProjectRefFromUrl(url: string): string | null {
  try {
    const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
    return match ? match[1] : null;
  } catch (e) {
    // Ignore parsing errors
  }
  return null;
}

// Initialize Supabase Admin client with dynamic project matching
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getMatchingSupabaseUrl(): string {
  const serviceKeyRef = getProjectRefFromKey(supabaseServiceKey);
  const dbUrl = process.env.SUPABASE_DB_URL || '';
  const viteUrl = process.env.VITE_SUPABASE_URL || '';
  
  if (serviceKeyRef) {
    if (getProjectRefFromUrl(dbUrl) === serviceKeyRef) {
      return dbUrl;
    }
    if (getProjectRefFromUrl(viteUrl) === serviceKeyRef) {
      return viteUrl;
    }
  }
  return dbUrl || viteUrl;
}

const supabaseUrl = getMatchingSupabaseUrl() || 'https://placeholder.supabase.co';
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || 'placeholder_key');

const activeRef = getProjectRefFromUrl(supabaseUrl);
const viteRef = getProjectRefFromUrl(process.env.VITE_SUPABASE_URL || '');
if (viteRef && activeRef && viteRef !== activeRef) {
  console.error(`[SUPABASE CONFIG MISMATCH WARNING]
  O frontend está configurado com o projeto Supabase: "${viteRef}" (VITE_SUPABASE_URL)
  O backend está configurado com o projeto Supabase: "${activeRef}" (SUPABASE_DB_URL)
  Isso causará falhas de sincronização de assinatura e autenticação porque eles usam bancos de dados diferentes!
  Por favor, atualize as credenciais no menu Settings do AI Studio para que apontem para o mesmo projeto.`);
}

/**
 * Runs PostgreSQL column migrations on startup to support account deletion tracking.
 */
async function runSchemaMigration() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.warn('[Migration] SUPABASE_DB_URL is missing. Skipping direct schema checks.');
    return;
  }
  
  try {
    console.log('[Migration] Conectando ao banco PostgreSQL para verificar colunas de exclusão de conta...');
    const sql = postgres(dbUrl, { ssl: 'require', connect_timeout: 10, max: 1 });
    
    await sql`
      ALTER TABLE public.profiles 
      ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active' CHECK (account_status IN ('active', 'pending_deletion')),
      ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS scheduled_deletion_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS plan_mismatch_pending BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS legal_acceptance_at TIMESTAMP WITH TIME ZONE;
    `;

    await sql`
      ALTER TABLE public.medications
      ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS keep_history BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
    `;

    await sql`
      ALTER TABLE public.appointments
      ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS keep_history BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
    `;
    
    console.log('[Migration] Configurando limites de plano (Gratuito vs Premium) e triggers...');
    await sql`
      CREATE OR REPLACE FUNCTION public.has_premium_access(user_uuid UUID)
      RETURNS BOOLEAN AS $$
      DECLARE
          u_plan TEXT;
          u_lifetime BOOLEAN;
          u_trial_ends TIMESTAMP WITH TIME ZONE;
          u_sub_status TEXT;
          u_sub_ends TIMESTAMP WITH TIME ZONE;
          now_tz TIMESTAMP WITH TIME ZONE := now();
      BEGIN
          SELECT plan, lifetime_access, trial_ends_at, subscription_status, subscription_ends_at
          INTO u_plan, u_lifetime, u_trial_ends, u_sub_status, u_sub_ends
          FROM public.profiles
          WHERE id = user_uuid;

          -- Se não encontrar o perfil, assume como gratuito
          IF NOT FOUND THEN
              RETURN FALSE;
          END IF;

          -- Verificação direta de plano premium ou acesso vitalício
          IF u_plan = 'premium' OR u_plan = 'lifetime_access' OR u_lifetime = TRUE THEN
              RETURN TRUE;
          END IF;

          -- Verificação de período de avaliação ativo
          IF u_trial_ends IS NOT NULL AND now_tz < u_trial_ends THEN
              RETURN TRUE;
          END IF;

          -- Verificação de assinatura ativa ou cancelada porém dentro do prazo pago
          -- Só confere acesso premium se o plano cadastrado for premium
          IF COALESCE(u_plan, 'free') = 'premium' AND u_sub_status = 'active' THEN
              IF u_sub_ends IS NULL OR now_tz < u_sub_ends THEN
                  RETURN TRUE;
              END IF;
          END IF;

          IF COALESCE(u_plan, 'free') = 'premium' AND u_sub_status = 'canceled' AND u_sub_ends IS NOT NULL AND now_tz < u_sub_ends THEN
              RETURN TRUE;
          END IF;

          RETURN FALSE;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `;

    await sql`
      CREATE OR REPLACE FUNCTION public.enforce_medications_limit()
      RETURNS TRIGGER AS $$
      DECLARE
          med_count INTEGER;
          is_premium BOOLEAN;
      BEGIN
          is_premium := public.has_premium_access(NEW.user_id);
          
          IF NOT is_premium AND COALESCE(NEW.active, true) = true AND (TG_OP = 'INSERT' OR COALESCE(OLD.active, true) = false) THEN
              SELECT COUNT(*) INTO med_count
              FROM public.medications
              WHERE user_id = NEW.user_id AND COALESCE(active, true) = true AND COALESCE(deleted, false) = false;
              
              IF med_count >= 3 THEN
                  RAISE EXCEPTION 'Limite do Plano Gratuito atingido: Você já cadastrou os 3 medicamentos ativos disponíveis.'
                      USING ERRCODE = 'P9999';
              END IF;
          END IF;
          
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `;

    await sql`
      CREATE OR REPLACE FUNCTION public.enforce_appointments_limit()
      RETURNS TRIGGER AS $$
      DECLARE
          app_count INTEGER;
          is_premium BOOLEAN;
      BEGIN
          is_premium := public.has_premium_access(NEW.user_id);
          
          IF NOT is_premium AND COALESCE(NEW.active, true) = true AND (TG_OP = 'INSERT' OR COALESCE(OLD.active, true) = false) THEN
              SELECT COUNT(*) INTO app_count
              FROM public.appointments
              WHERE user_id = NEW.user_id AND COALESCE(active, true) = true AND COALESCE(deleted, false) = false;
              
              IF app_count >= 5 THEN
                  RAISE EXCEPTION 'Limite do Plano Gratuito atingido: Você já cadastrou os 5 compromissos ativos disponíveis.'
                      USING ERRCODE = 'P9998';
              END IF;
          END IF;
          
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `;

    await sql`
      DROP TRIGGER IF EXISTS trigger_enforce_medications_limit ON public.medications;
      CREATE TRIGGER trigger_enforce_medications_limit
          BEFORE INSERT OR UPDATE ON public.medications
          FOR EACH ROW
          EXECUTE FUNCTION public.enforce_medications_limit();
    `;

    await sql`
      DROP TRIGGER IF EXISTS trigger_enforce_appointments_limit ON public.appointments;
      CREATE TRIGGER trigger_enforce_appointments_limit
          BEFORE INSERT OR UPDATE ON public.appointments
          FOR EACH ROW
          EXECUTE FUNCTION public.enforce_appointments_limit();
    `;
    console.log('[Migration] Triggers e funções de limite de plano criados/atualizados com sucesso!');
    
    console.log('[Migration] Verificando se a tabela public.active_sessions existe com a nova estrutura de chaves...');
    
    // Check primary key of public.active_sessions to migrate safely if needed
    let isSessionIdPK = false;
    try {
      const keyCheck = await sql`
        SELECT a.attname
        FROM   pg_index i
        JOIN   pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE  i.indrelid = 'public.active_sessions'::regclass
        AND    i.indisprimary;
      `;
      isSessionIdPK = keyCheck.some(row => row.attname === 'session_id');
      
      if (keyCheck.length > 0 && !isSessionIdPK) {
        console.log('[Migration] Estrutura antiga de active_sessions detectada. Recriando tabela para suportar replicação Realtime...');
        await sql`DROP TABLE IF EXISTS public.active_sessions CASCADE;`;
      }
    } catch (e) {
      // Table doesn't exist yet, which is expected on first run
      console.log('[Migration] Tabela active_sessions será criada pela primeira vez.');
    }

    await sql`
      CREATE TABLE IF NOT EXISTS public.active_sessions (
        session_id TEXT PRIMARY KEY,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
        last_activity TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
        user_agent TEXT,
        os TEXT,
        browser TEXT,
        device_type TEXT
      );
    `;

    console.log('[Migration] Ativando Row Level Security na tabela active_sessions...');
    await sql`ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;`;

    // Drop policies to recreate them cleanly (idempotent)
    await sql`DROP POLICY IF EXISTS "Users can view their own active sessions" ON public.active_sessions;`;
    await sql`DROP POLICY IF EXISTS "Users can insert their own active sessions" ON public.active_sessions;`;
    await sql`DROP POLICY IF EXISTS "Users can update their own active sessions" ON public.active_sessions;`;
    await sql`DROP POLICY IF EXISTS "Users can delete their own active sessions" ON public.active_sessions;`;

    console.log('[Migration] Criando políticas de segurança RLS para active_sessions...');
    await sql`
      CREATE POLICY "Users can view their own active sessions" 
      ON public.active_sessions FOR SELECT 
      TO authenticated 
      USING (auth.uid() = user_id);
    `;

    await sql`
      CREATE POLICY "Users can insert their own active sessions" 
      ON public.active_sessions FOR INSERT 
      TO authenticated 
      WITH CHECK (auth.uid() = user_id);
    `;

    await sql`
      CREATE POLICY "Users can update their own active sessions" 
      ON public.active_sessions FOR UPDATE 
      TO authenticated 
      USING (auth.uid() = user_id) 
      WITH CHECK (auth.uid() = user_id);
    `;

    await sql`
      CREATE POLICY "Users can delete their own active sessions" 
      ON public.active_sessions FOR DELETE 
      TO authenticated 
      USING (auth.uid() = user_id);
    `;

    console.log('[Migration] Colunas de exclusão e tabela de sessões verificadas/criadas com sucesso no banco de dados!');
    
    // Force Supabase API cache (PostgREST) to reload and pick up the new columns immediately
    try {
      console.log('[Migration] Notificando PostgREST para recarregar o cache do schema...');
      await sql`NOTIFY pgrst, 'reload schema';`;
    } catch (notifyErr: any) {
      console.warn('[Migration] Não foi possível enviar NOTIFY pgrst (não crítico):', notifyErr.message || notifyErr);
    }

    await sql.end();
  } catch (err: any) {
    console.error('[Migration] Erro ao rodar migração de colunas:', err.message || err);
  }
}

/**
 * Scans hourly (and on startup) for accounts marked for deletion whose scheduled time has elapsed,
 * and deletes them from Auth Admin (which cascade deletes all operations data).
 */
function startScheduledDeletionWorker() {
  console.log('[Worker] Iniciando worker de exclusão de contas agendadas...');
  
  const checkAndRunDeletions = async () => {
    try {
      const now = new Date().toISOString();
      console.log(`[Worker] Verificando exclusões programadas pendentes... (Hora atual: ${now})`);
      
      let pendingDeletions: Array<{ id: string; email?: string }> = [];

      // 1. Try profiles table
      try {
        const { data: profiles, error } = await supabaseAdmin
          .from('profiles')
          .select('id, email')
          .eq('account_status', 'pending_deletion')
          .lte('scheduled_deletion_at', now);

        if (!error && profiles) {
          const typedProfiles = profiles as Array<{ id: string; email?: string }>;
          pendingDeletions = typedProfiles.map(p => ({
            id: p.id,
            email: p.email
          }));
        } else if (error) {
          console.warn('[Worker] Profiles query failed (likely missing columns):', error.message);
        }
      } catch (dbErr: any) {
        console.warn('[Worker] Profiles query threw exception:', dbErr.message || dbErr);
      }

      // 2. Auth user_metadata Backup Fallback: Scan listUsers for key values
      try {
        const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
        if (!listErr && users) {
          for (const user of users) {
            const meta = user.user_metadata || {};
            if (meta.account_status === 'pending_deletion') {
              const scheduledAt = meta.scheduled_deletion_at;
              if (scheduledAt && scheduledAt <= now) {
                if (!pendingDeletions.some(p => p.id === user.id)) {
                  console.log(`[Worker] Falling back to user_metadata: scheduled deletion found for ${user.id}`);
                  pendingDeletions.push({ id: user.id, email: user.email });
                }
              }
            }
          }
        } else if (listErr) {
          console.error('[Worker] listUsers fallback failed:', listErr.message);
        }
      } catch (listCatch: any) {
        console.error('[Worker] listUsers fallback threw exception:', listCatch.message || listCatch);
      }
      
      if (pendingDeletions.length === 0) {
        return;
      }
      
      console.log(`[Worker] Encontradas ${pendingDeletions.length} contas para exclusão definitiva.`);
      
      for (const profile of pendingDeletions) {
        console.log(`[Worker] Excluindo permanentemente a conta do usuário ${profile.id} (${profile.email || 'sem e-mail'})`);
        
        const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(profile.id);
        if (deleteErr) {
          console.error(`[Worker] Falha ao excluir usuário ${profile.id}:`, deleteErr.message);
        } else {
          console.log(`[Worker] Usuário ${profile.id} excluído com sucesso (e todos os dados associados cascateados).`);
        }
      }
    } catch (err: any) {
      console.error('[Worker] Erro inesperado no job de exclusão:', err.message || err);
    }
  };
  
  // Run on startup
  checkAndRunDeletions();
  
  // Run every 10 minutes
  setInterval(checkAndRunDeletions, 10 * 60 * 1000);
}

async function createServer() {
  const app = express();

  // Logging middleware to help debug backend API requests
  app.use((req, res, next) => {
    if (req.url.startsWith('/api/')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    }
    next();
  });

  // Support JSON request parser
  app.use(express.json());

  // 1. Stripe Endpoints
  app.post('/api/stripe/checkout', (req, res) => checkoutHandler(req as any, res as any));
  app.post('/api/stripe/create-portal-session', (req, res) => portalHandler(req as any, res as any));
  app.post('/api/stripe/sync-subscription', (req, res) => syncHandler(req as any, res as any));
  app.post('/api/stripe/webhook', (req, res) => webhookHandler(req as any, res as any));



  // 2. Safe and Secure Authentication-Authorized Account Deletion API Endpoint
  app.post('/api/user/delete', async (req, res): Promise<any> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nenhum token de autorização fornecido' });
    }

    const token = authHeader.split(' ')[1];

    try {
      // Authenticate via Supabase Auth
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !user) {
        return res.status(401).json({ error: 'Sessão inválida ou expirada. Por favor, faça login novamente.' });
      }

      const userId = user.id;
      const { action } = req.body;

      if (!action) {
        return res.status(400).json({ error: 'Ação é obrigatória (delete ou cancel).' });
      }

      // Fetch user profile securely
      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileErr || !profile) {
        return res.status(404).json({ error: 'Perfil do usuário não encontrado.' });
      }

      if (action === 'delete') {
        const isPremiumActive = profile.plan === 'premium' && 
          (profile.subscription_status === 'active' || profile.subscription_status === 'trial');

        if (isPremiumActive) {
          return res.status(400).json({
            error: 'Você possui uma assinatura Premium ativa. Cancele sua assinatura primeiro. Após o cancelamento da renovação automática, a exclusão da conta ficará disponível.'
          });
        }

        const isPremiumCanceled = profile.plan === 'premium' && profile.subscription_status === 'canceled';

        if (isPremiumCanceled) {
          const nowStr = new Date().toISOString();
          const scheduledDate = profile.subscription_ends_at || nowStr;

          // Mark profile as pending deletion
          const { error: updateErr } = await supabaseAdmin
            .from('profiles')
            .update({
              account_status: 'pending_deletion',
              deletion_requested_at: nowStr,
              scheduled_deletion_at: scheduledDate,
              updated_at: nowStr
            })
            .eq('id', userId);

          if (updateErr) {
            console.error('[DeleteAPI] Erro ao agendar exclusão:', updateErr);
            return res.status(500).json({ error: 'Falha ao agendar exclusão da conta.' });
          }

          return res.status(200).json({
            status: 'scheduled',
            scheduled_deletion_at: scheduledDate,
            message: 'Sua conta foi agendada para exclusão.'
          });
        }

        // Free user (or expired subscriber): Delete immediately
        console.log(`[DeleteAPI] Usuário Free ${userId} solicitou exclusão. Excluindo conta imediatamente.`);
        const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId);

        if (deleteErr) {
          console.error('[DeleteAPI] Erro ao excluir usuário:', deleteErr);
          return res.status(500).json({ error: 'Falha ao excluir a conta.' });
        }

        return res.status(200).json({
          status: 'deleted',
          message: 'Sua conta foi excluída com sucesso.'
        });

      } else if (action === 'cancel') {
        if (profile.account_status !== 'pending_deletion') {
          return res.status(400).json({ error: 'Sua conta não possui uma exclusão agendada ativa.' });
        }

        const { error: updateErr } = await supabaseAdmin
          .from('profiles')
          .update({
            account_status: 'active',
            deletion_requested_at: null,
            scheduled_deletion_at: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        if (updateErr) {
          console.error('[DeleteAPI] Erro ao cancelar exclusão:', updateErr);
          return res.status(500).json({ error: 'Falha ao cancelar exclusão.' });
        }

        return res.status(200).json({
          status: 'active',
          message: 'Agendamento de exclusão cancelado com sucesso.'
        });

      } else {
        return res.status(400).json({ error: 'Ação inválida.' });
      }

    } catch (err: any) {
      console.error('[DeleteAPI] Erro na API de exclusão de usuário:', err);
      return res.status(500).json({ error: 'Erro interno ao processar requisição.' });
    }
  });

  // Helper to safely preserve earliest event timestamp
  function getEarliestIso(a?: string, b?: string): string | undefined {
    if (!a) return b;
    if (!b) return a;
    try {
      return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
    } catch {
      return a || b;
    }
  }

  // Push Notification Telemetry Endpoint for Service Worker receipts
  app.post('/api/telemetry/push-received', express.json(), async (req, res) => {
    const { 
      notification_id, 
      event_type, 
      timestamp, 
      tag, 
      title, 
      user_agent, 
      device_type,
      endpoint,
      error,
      show_notification_started_at,
      completed_at,
      failed_at,
      sw_received_at
    } = req.body || {};
    const eventTime = timestamp || new Date().toISOString();

    console.log(`[Push Telemetry API] ${event_type} for notification ${notification_id} on ${device_type || 'unknown'} at ${eventTime}`);

    if (!notification_id) {
      return res.status(400).json({ error: 'notification_id is required' });
    }

    try {
      const { data: current } = await supabaseAdmin
        .from('notification_queue')
        .select('metadata, scheduled_at, trigger_at')
        .eq('id', notification_id)
        .maybeSingle();

      if (current) {
        const existingMeta = current.metadata || {};
        const telemetryEvents: any[] = existingMeta.telemetry_events || [];
        const devicesMap: Record<string, any> = existingMeta.devices || {};

        // Generate consistent device key (endpoint suffix or sanitized UA/type)
        let deviceKey = 'unknown_device';
        if (endpoint && typeof endpoint === 'string') {
          const cleanEndpoint = endpoint.split('?')[0];
          deviceKey = 'ep_' + cleanEndpoint.slice(-32).replace(/[^a-zA-Z0-9_-]/g, '_');
        } else if (user_agent || device_type) {
          const uaSlug = (user_agent || 'unknown').slice(0, 35).replace(/[^a-zA-Z0-9_-]/g, '_');
          deviceKey = `${device_type || 'dev'}_${uaSlug}`;
        }

        const scheduledTime = current.scheduled_at || current.trigger_at;
        const existingDevice = devicesMap[deviceKey] || {
          device_key: deviceKey,
          device_type: device_type || (user_agent?.includes('Android') ? 'android' : (user_agent?.includes('iPhone') ? 'ios' : 'desktop')),
          user_agent: user_agent || 'unknown',
          endpoint_snippet: endpoint && typeof endpoint === 'string' ? (endpoint.length > 50 ? endpoint.slice(0, 30) + '...' + endpoint.slice(-20) : endpoint) : undefined
        };

        // Update device type and UA if more specific
        if (device_type && !existingDevice.device_type) {
          existingDevice.device_type = device_type;
        }
        if (user_agent && existingDevice.user_agent === 'unknown') {
          existingDevice.user_agent = user_agent;
        }

        if (event_type === 'service_worker_push_received') {
          const receivedTime = sw_received_at || eventTime;
          existingDevice.sw_received_at = getEarliestIso(existingDevice.sw_received_at, receivedTime);
        } else if (event_type === 'show_notification_started') {
          const startTime = show_notification_started_at || eventTime;
          existingDevice.show_notification_started_at = getEarliestIso(existingDevice.show_notification_started_at, startTime);
          if (!existingDevice.sw_received_at) {
            existingDevice.sw_received_at = existingDevice.show_notification_started_at;
          }
        } else if (event_type === 'show_notification_completed') {
          const compTime = completed_at || eventTime;
          existingDevice.show_notification_completed_at = getEarliestIso(existingDevice.show_notification_completed_at, compTime);
        } else if (event_type === 'show_notification_failed') {
          const failTime = failed_at || eventTime;
          existingDevice.show_notification_failed_at = getEarliestIso(existingDevice.show_notification_failed_at, failTime);
          existingDevice.show_notification_error = error;
        }

        if (existingDevice.sw_received_at && scheduledTime) {
          const delayMs = new Date(existingDevice.sw_received_at).getTime() - new Date(scheduledTime).getTime();
          existingDevice.delay_from_schedule_ms = delayMs;
          existingDevice.delay_from_schedule_str = (delayMs / 60000).toFixed(2) + ' min';
        }

        existingDevice.last_event = event_type;
        existingDevice.last_event_at = eventTime;
        devicesMap[deviceKey] = existingDevice;

        // Avoid adding duplicate telemetry events
        const isDuplicateEvent = telemetryEvents.some(
          e => e.device_key === deviceKey && e.event_type === event_type && e.timestamp === eventTime
        );

        if (!isDuplicateEvent) {
          telemetryEvents.push({
            event_type,
            timestamp: eventTime,
            tag,
            title,
            user_agent,
            device_type,
            device_key: deviceKey,
            endpoint_snippet: existingDevice.endpoint_snippet,
            error
          });
        }

        const updatedMeta: any = {
          ...existingMeta,
          devices: devicesMap,
          telemetry_events: telemetryEvents,
          sw_receipt_observed: true,
          last_sw_event: event_type,
          last_sw_event_at: eventTime
        };

        // Maintain global convenience timestamps using earliest dates
        if (event_type === 'service_worker_push_received') {
          updatedMeta.sw_received_at = getEarliestIso(existingMeta.sw_received_at, sw_received_at || eventTime);
        } else if (event_type === 'show_notification_started') {
          updatedMeta.show_notification_started_at = getEarliestIso(existingMeta.show_notification_started_at, show_notification_started_at || eventTime);
          if (!updatedMeta.sw_received_at) {
            updatedMeta.sw_received_at = updatedMeta.show_notification_started_at;
          }
        } else if (event_type === 'show_notification_completed') {
          updatedMeta.show_notification_completed_at = getEarliestIso(existingMeta.show_notification_completed_at, completed_at || eventTime);
        } else if (event_type === 'show_notification_failed') {
          updatedMeta.show_notification_failed_at = getEarliestIso(existingMeta.show_notification_failed_at, failed_at || eventTime);
          updatedMeta.show_notification_error = error;
        }

        await supabaseAdmin
          .from('notification_queue')
          .update({ metadata: updatedMeta })
          .eq('id', notification_id);
      }

      return res.json({ success: true, notification_id, event_type, recorded_at: eventTime });
    } catch (err: any) {
      console.error('[Push Telemetry API Error]:', err);
      return res.status(500).json({ error: err?.message || String(err) });
    }
  });

  // Push Telemetry Summary Report Endpoint with Multi-Device Diagnostics
  app.get('/api/telemetry/report', async (req, res) => {
    try {
      const { data: items, error } = await supabaseAdmin
        .from('notification_queue')
        .select('id, user_id, title, trigger_at, scheduled_at, sent, sent_at, metadata, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const filteredItems = (items || []).filter(item => {
        const meta = item.metadata || {};
        return Boolean(
          meta.backend_processed_at ||
          meta.web_push_attempted ||
          (meta.telemetry_events && meta.telemetry_events.length > 0)
        );
      }).slice(0, 30);

      const report = filteredItems.map(item => {
        const meta = item.metadata || {};
        const scheduled = item.scheduled_at || item.trigger_at;
        const acceptedAt = meta.push_service_accepted_at || item.sent_at;
        const deliveryAttempts: any[] = meta.delivery_attempts || [];
        const devicesMap: { [key: string]: any } = meta.devices || {};

        // Correlate delivery attempts with device telemetry
        const devicesReport: any[] = [];
        const seenDeviceKeys = new Set<string>();

        if (deliveryAttempts.length > 0) {
          deliveryAttempts.forEach((attempt: any) => {
            const rawEndpoint = attempt.endpoint || '';
            const cleanEndpoint = rawEndpoint.split('?')[0];
            const epKey = cleanEndpoint ? 'ep_' + cleanEndpoint.slice(-32).replace(/[^a-zA-Z0-9_-]/g, '_') : '';
            
            // Try finding matching telemetry by endpoint key or by device_type/user_agent
            let telemetryMatch = epKey ? devicesMap[epKey] : null;
            if (!telemetryMatch) {
              const matchedKey = Object.keys(devicesMap).find(k => {
                const dev = devicesMap[k];
                if (seenDeviceKeys.has(k)) return false;
                if (dev.device_type === attempt.device_type) return true;
                if (dev.user_agent && attempt.user_agent && dev.user_agent === attempt.user_agent) return true;
                return false;
              });
              if (matchedKey) {
                telemetryMatch = devicesMap[matchedKey];
                seenDeviceKeys.add(matchedKey);
              }
            } else {
              seenDeviceKeys.add(epKey);
            }

            const devType = telemetryMatch?.device_type || attempt.device_type || (attempt.user_agent?.includes('Android') ? 'android' : (attempt.user_agent?.includes('iPhone') ? 'ios' : 'desktop'));
            const swReceived = telemetryMatch?.sw_received_at || null;
            const showStarted = telemetryMatch?.show_notification_started_at || null;
            const showCompleted = telemetryMatch?.show_notification_completed_at || null;
            const showFailed = telemetryMatch?.show_notification_failed_at || null;
            const showErr = telemetryMatch?.show_notification_error || null;

            let devDelayMs: number | null = null;
            let devDelayStr = 'N/A';
            if (swReceived && scheduled) {
              devDelayMs = new Date(swReceived).getTime() - new Date(scheduled).getTime();
              devDelayStr = (devDelayMs / 60000).toFixed(2) + ' min';
            }

            let devState = 'PENDING';
            let diagnosticNote = '';

            if (!attempt.success) {
              devState = 'PUSH_SERVICE_FAILED';
              diagnosticNote = `Push service rejected token: ${attempt.error || attempt.statusCode || 'Unknown error'}`;
            } else if (showFailed || showErr) {
              devState = 'SHOW_NOTIFICATION_FAILED';
              diagnosticNote = `Service Worker received push but failed to display notification: ${showErr}`;
            } else if (swReceived) {
              if (Math.abs(devDelayMs || 0) > 120000) {
                devState = 'DELIVERED_WITH_DELAY';
                diagnosticNote = devType === 'android'
                  ? `Delivered with delay of ${devDelayStr}. Confirmed by Service Worker (typical of Android Doze Mode / Locked Screen).`
                  : `Delivered with delay of ${devDelayStr}. Confirmed by Service Worker.`;
              } else {
                devState = 'DELIVERED_PROMPTLY';
                diagnosticNote = 'Delivered promptly on scheduled time.';
              }
            } else {
              devState = 'AWAITING_RECEIPT_CONFIRMATION';
              diagnosticNote = devType === 'android'
                ? 'Accepted by push service (FCM). Awaiting Service Worker receipt confirmation (device may be locked, in Doze Mode, or offline).'
                : 'Accepted by push service. Awaiting Service Worker receipt confirmation.';
            }

            devicesReport.push({
              device_type: devType,
              user_agent: attempt.user_agent || telemetryMatch?.user_agent || 'unknown',
              endpoint_masked: attempt.endpoint_masked || (rawEndpoint.substring(0, 35) + '...'),
              push_service_accepted_at: attempt.accepted_at || acceptedAt,
              sw_received_at: swReceived,
              show_notification_started_at: showStarted,
              show_notification_completed_at: showCompleted,
              show_notification_failed_at: showFailed,
              show_notification_error: showErr,
              delay_from_schedule: devDelayStr,
              delay_ms: devDelayMs,
              device_state: devState,
              diagnostic_note: diagnosticNote
            });
          });
        }

        // Include any additional devices that reported telemetry but weren't in deliveryAttempts
        Object.keys(devicesMap).forEach(k => {
          if (seenDeviceKeys.has(k)) return;
          const dev = devicesMap[k];
          let devDelayMs: number | null = null;
          let devDelayStr = 'N/A';
          if (dev.sw_received_at && scheduled) {
            devDelayMs = new Date(dev.sw_received_at).getTime() - new Date(scheduled).getTime();
            devDelayStr = (devDelayMs / 60000).toFixed(2) + ' min';
          }

          let devState = 'PENDING';
          if (dev.show_notification_failed_at || dev.show_notification_error) {
            devState = 'SHOW_NOTIFICATION_FAILED';
          } else if (dev.sw_received_at) {
            devState = Math.abs(devDelayMs || 0) > 120000 ? 'DELIVERED_WITH_DELAY' : 'DELIVERED_PROMPTLY';
          }

          devicesReport.push({
            device_type: dev.device_type || 'unknown',
            user_agent: dev.user_agent || 'unknown',
            endpoint_masked: dev.endpoint_snippet || 'unknown',
            push_service_accepted_at: acceptedAt,
            sw_received_at: dev.sw_received_at || null,
            show_notification_started_at: dev.show_notification_started_at || null,
            show_notification_completed_at: dev.show_notification_completed_at || null,
            show_notification_failed_at: dev.show_notification_failed_at || null,
            show_notification_error: dev.show_notification_error || null,
            delay_from_schedule: devDelayStr,
            delay_ms: devDelayMs,
            device_state: devState,
            diagnostic_note: devState === 'DELIVERED_PROMPTLY' ? 'Delivered promptly' : 'Delivered with delay'
          });
        });

        // Global metrics calculation
        const totalTargeted = devicesReport.length;
        const promptlyDelivered = devicesReport.filter(d => d.device_state === 'DELIVERED_PROMPTLY').length;
        const delayedDelivered = devicesReport.filter(d => d.device_state === 'DELIVERED_WITH_DELAY').length;
        const awaitingConfirmation = devicesReport.filter(d => d.device_state === 'AWAITING_RECEIPT_CONFIRMATION').length;
        const showFailedCount = devicesReport.filter(d => d.device_state === 'SHOW_NOTIFICATION_FAILED').length;
        const pushFailedCount = devicesReport.filter(d => d.device_state === 'PUSH_SERVICE_FAILED').length;

        // Overall classification & diagnosis summary
        let overallDeliveryState = 'PENDING';
        let diagnosisSummary = '';

        if (meta.status === 'discarded') {
          overallDeliveryState = 'DISCARDED';
          diagnosisSummary = 'Notification was discarded (user disabled notifications or no active subscription).';
        } else if (meta.status === 'failed' || (pushFailedCount === totalTargeted && totalTargeted > 0)) {
          overallDeliveryState = 'PUSH_SERVICE_FAILED';
          diagnosisSummary = 'Failed to dispatch Web Push to push service.';
        } else if (showFailedCount > 0) {
          overallDeliveryState = 'SHOW_NOTIFICATION_FAILED';
          diagnosisSummary = `${showFailedCount} device(s) failed inside showNotification.`;
        } else if (totalTargeted > 0) {
          const pcDevice = devicesReport.find(d => d.device_type === 'desktop');
          const mobileDevice = devicesReport.find(d => d.device_type === 'android' || d.device_type === 'ios');

          if (promptlyDelivered === totalTargeted) {
            overallDeliveryState = 'ALL_DEVICES_DELIVERED_PROMPTLY';
            diagnosisSummary = `All ${totalTargeted} device(s) received and displayed the notification promptly.`;
          } else if (pcDevice?.device_state === 'DELIVERED_PROMPTLY' && mobileDevice?.device_state === 'DELIVERED_WITH_DELAY') {
            overallDeliveryState = 'PC_PROMPT_ANDROID_DELAYED';
            diagnosisSummary = `PC delivered promptly, but Android was delayed by ${mobileDevice.delay_from_schedule} (Service Worker confirmed receipt after delay).`;
          } else if (pcDevice?.device_state === 'DELIVERED_PROMPTLY' && mobileDevice?.device_state === 'AWAITING_RECEIPT_CONFIRMATION') {
            overallDeliveryState = 'PC_PROMPT_ANDROID_AWAITING_RECEIPT';
            diagnosisSummary = `PC delivered promptly. Android has not reported receipt confirmation yet (device may be locked, in Doze Mode, or offline).`;
          } else if (delayedDelivered === totalTargeted) {
            overallDeliveryState = 'DELIVERED_WITH_DELAY';
            diagnosisSummary = `All ${totalTargeted} device(s) experienced delivery delay.`;
          } else if (awaitingConfirmation === totalTargeted) {
            overallDeliveryState = 'ACCEPTED_BY_PUSH_SERVICE_AWAITING_DEVICES';
            diagnosisSummary = `Push accepted by push service. All ${totalTargeted} device(s) are awaiting receipt confirmation.`;
          } else {
            overallDeliveryState = 'PARTIAL_DELIVERY';
            diagnosisSummary = `${promptlyDelivered}/${totalTargeted} devices delivered promptly (${awaitingConfirmation} awaiting confirmation, ${delayedDelivered} delayed).`;
          }
        } else {
          // Fallback if no device attempts array
          const swReceivedAt = meta.sw_received_at;
          const showFailedAt = meta.show_notification_failed_at;
          let delayMs = null;
          let delayMinutesStr = 'N/A';
          if (swReceivedAt && scheduled) {
            delayMs = new Date(swReceivedAt).getTime() - new Date(scheduled).getTime();
            delayMinutesStr = (delayMs / 60000).toFixed(2) + ' min';
          }
          if (showFailedAt || meta.show_notification_error) {
            overallDeliveryState = 'SHOW_NOTIFICATION_FAILED';
          } else if (swReceivedAt) {
            overallDeliveryState = Math.abs(delayMs || 0) > 120000 ? 'DELIVERED_WITH_DELAY' : 'DELIVERED_PROMPTLY';
          } else {
            overallDeliveryState = 'ACCEPTED_BY_PUSH_SERVICE_NO_SW_RECEIPT';
          }
          diagnosisSummary = `Overall state: ${overallDeliveryState}`;
        }

        return {
          notification_id: item.id,
          title: item.title,
          scheduled_at: scheduled,
          backend_processed_at: meta.backend_processed_at,
          push_service_accepted_at: acceptedAt,
          overall_delivery_state: overallDeliveryState,
          diagnosis_summary: diagnosisSummary,
          targeted_devices_count: totalTargeted,
          delivered_promptly_count: promptlyDelivered,
          delayed_delivered_count: delayedDelivered,
          awaiting_confirmation_count: awaitingConfirmation,
          devices: devicesReport,
          legacy: {
            sw_received_at: meta.sw_received_at || null,
            show_notification_started_at: meta.show_notification_started_at || null,
            show_notification_completed_at: meta.show_notification_completed_at || null,
            show_notification_failed_at: meta.show_notification_failed_at || null,
            show_notification_error: meta.show_notification_error || null,
            delivery_state: overallDeliveryState
          },
          events: meta.telemetry_events || []
        };
      });

      return res.json({
        total: report.length,
        timestamp: new Date().toISOString(),
        report
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || String(err) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

const PORT = 3000;
createServer().then(app => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Run PostgreSQL direct schema migration without blocking server startup
    runSchemaMigration().catch(err => {
      console.error('[Migration] Non-blocking schema migration error:', err);
    });
    
    // Start the background cron worker to complete scheduled deletions
    startScheduledDeletionWorker();
  });
}).catch(err => {
  console.error('[Server] Fatal error creating server:', err);
});
