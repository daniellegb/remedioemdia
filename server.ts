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
      ADD COLUMN IF NOT EXISTS scheduled_deletion_at TIMESTAMP WITH TIME ZONE;
    `;
    
    console.log('[Migration] Colunas de exclusão verificadas/criadas com sucesso no banco de dados!');
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
      
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email')
        .eq('account_status', 'pending_deletion')
        .lte('scheduled_deletion_at', now);
        
      if (error) {
        console.error('[Worker] Erro ao buscar exclusões pendentes:', error.message);
        return;
      }
      
      if (!profiles || profiles.length === 0) {
        return;
      }
      
      console.log(`[Worker] Encontradas ${profiles.length} contas para exclusão definitiva.`);
      
      for (const profile of profiles) {
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
