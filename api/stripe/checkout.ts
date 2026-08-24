import { VercelRequest, VercelResponse } from '@vercel/node';
import { stripeServerService, supabaseAdmin } from './stripeServerService.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[${new Date().toISOString()}] Checkout request: ${req.method} ${req.url}`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Exigir e extrair o token do cabeçalho Authorization: Bearer <access_token>
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[Checkout] Requisição rejeitada: nenhum token Authorization fornecido.');
    return res.status(401).json({ error: 'Nenhum token de autorização fornecido' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    console.warn('[Checkout] Requisição rejeitada: token em branco.');
    return res.status(401).json({ error: 'Token de autorização em branco' });
  }

  // 2. Validar o JWT no backend usando Supabase Auth
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    console.warn('[Checkout] Requisição rejeitada: JWT inválido ou expirado.', authError?.message);
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Por favor, faça login novamente.' });
  }

  // 3. Determinar a identidade EXCLUSIVAMENTE pelo user.id do JWT validado
  const authenticatedUserId = user.id;
  const authenticatedUserEmail = user.email;

  // 4. Se o frontend enviar profile, tratar apenas como dado não confiável e validar que não altera a identidade
  const { profile } = req.body || {};
  if (profile?.id && profile.id !== authenticatedUserId) {
    console.warn(`[Checkout] Tentativa de adulteração de identidade detectada: Auth User ID (${authenticatedUserId}) != Request Profile ID (${profile.id})`);
    return res.status(403).json({ error: 'Acesso negado: ID de perfil incompatível com o usuário autenticado.' });
  }

  try {
    // 5. Iniciar a sessão de checkout utilizando exclusivamente os dados autenticados
    const sessionUrl = await stripeServerService.createCheckoutSession(authenticatedUserId, authenticatedUserEmail);
    console.log(`[Checkout] Sessão criada com sucesso para o usuário autenticado ${authenticatedUserId}`);
    return res.status(200).json({ url: sessionUrl });
  } catch (error: any) {
    console.error('[Checkout] Error:', error);
    return res.status(500).json({ error: error.message || 'Erro interno ao criar sessão de checkout' });
  }
}

