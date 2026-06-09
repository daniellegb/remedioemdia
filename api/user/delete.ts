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

    const currentAccountStatus = profile.account_status || user.user_metadata?.account_status || 'active';

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

        // 1. Try to update profiles table. If it fails, log and continue.
        let profilesUpdateSuccessful = false;
        try {
          const { error: updateErr } = await supabaseAdmin
            .from('profiles')
            .update({
              account_status: 'pending_deletion',
              deletion_requested_at: nowStr,
              scheduled_deletion_at: scheduledDate,
              updated_at: nowStr
            })
            .eq('id', userId);

          if (!updateErr) {
            profilesUpdateSuccessful = true;
          } else {
            console.warn('[DeleteAPI] Direct profiles table update failed (likely missing columns):', updateErr.message);
          }
        } catch (dbErr: any) {
          console.warn('[DeleteAPI] Direct profiles table update threw exception:', dbErr.message || dbErr);
        }

        // 2. Always update user_metadata in Auth as a rock-solid backup
        let metaUpdateSuccessful = false;
        try {
          const { error: metaErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            user_metadata: {
              ...(user.user_metadata || {}),
              account_status: 'pending_deletion',
              deletion_requested_at: nowStr,
              scheduled_deletion_at: scheduledDate
            }
          });
          if (!metaErr) {
            metaUpdateSuccessful = true;
          } else {
            console.error('[DeleteAPI] Failed to update user_metadata in Auth:', metaErr.message);
          }
        } catch (metaErr: any) {
          console.error('[DeleteAPI] Auth meta update exception:', metaErr.message || metaErr);
        }

        // Return success if at least one carrier updated the information
        if (!profilesUpdateSuccessful && !metaUpdateSuccessful) {
          return res.status(500).json({ error: 'Falha ao agendar exclusão da conta no banco de dados e nos metadados.' });
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
      if (currentAccountStatus !== 'pending_deletion') {
        return res.status(400).json({ error: 'Sua conta não possui uma exclusão agendada ativa.' });
      }

      // 1. Try to update profiles table. If it fails, log and continue.
      let profilesUpdateSuccessful = false;
      try {
        const { error: updateErr } = await supabaseAdmin
          .from('profiles')
          .update({
            account_status: 'active',
            deletion_requested_at: null,
            scheduled_deletion_at: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        if (!updateErr) {
          profilesUpdateSuccessful = true;
        } else {
          console.warn('[DeleteAPI] Direct profiles table update during cancel failed:', updateErr.message);
        }
      } catch (dbErr: any) {
        console.warn('[DeleteAPI] Direct profiles table update during cancel threw exception:', dbErr.message || dbErr);
      }

      // 2. Always update user_metadata in Auth as a fallback/backup
      let metaUpdateSuccessful = false;
      try {
        const { error: metaErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          user_metadata: {
            ...(user.user_metadata || {}),
            account_status: 'active',
            deletion_requested_at: null,
            scheduled_deletion_at: null
          }
        });
        if (!metaErr) {
          metaUpdateSuccessful = true;
        } else {
          console.error('[DeleteAPI] Failed to update user_metadata during cancel:', metaErr.message);
        }
      } catch (metaErr: any) {
        console.error('[DeleteAPI] Auth meta update exception during cancel:', metaErr.message || metaErr);
      }

      if (!profilesUpdateSuccessful && !metaUpdateSuccessful) {
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
