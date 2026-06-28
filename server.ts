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

// Initialize Supabase Admin client
const supabaseUrl = process.env.SUPABASE_DB_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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
    const sql = postgres(dbUrl, { ssl: 'require' });
    
    await sql`
      ALTER TABLE public.profiles 
      ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active' CHECK (account_status IN ('active', 'pending_deletion')),
      ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS scheduled_deletion_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS plan_mismatch_pending BOOLEAN DEFAULT FALSE;
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

  // Logging middleware to help debug backend requests
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
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
createServer().then(async app => {
  // Run PostgreSQL direct schema migration
  await runSchemaMigration();
  
  // Start the background cron worker to complete scheduled deletions
  startScheduledDeletionWorker();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
