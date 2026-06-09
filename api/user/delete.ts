import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Admin client
const supabaseUrl = process.env.SUPABASE_DB_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[${new Date().toISOString()}] Delete request: ${req.method} ${req.url}`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
}
