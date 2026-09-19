import { VercelRequest, VercelResponse } from '@vercel/node';
import { stripeServerService, supabaseAdmin } from './stripeServerService.js';

async function verifyTurnstileToken(token: string): Promise<boolean> {
  if (!token) return false;
  const secret = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });
    const data: any = await response.json();
    if (!data.success) {
      console.error(
        '[Turnstile] Rejeitado pela Cloudflare. Error codes:',
        data['error-codes'],
        'hostname:',
        data.hostname,
        'action:',
        data.action
      );
    }
    return !!data.success;
  } catch (err) {
    console.error('[Turnstile] Erro ao validar token:', err);
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[${new Date().toISOString()}] Checkout request: ${req.method} ${req.url}`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;

  // FLUXO 1: USUÁRIO AUTENTICADO (com Bearer JWT)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (!token) {
      console.warn('[Checkout] Requisição rejeitada: token em branco.');
      return res.status(401).json({ error: 'Token de autorização em branco' });
    }

    // Validar o JWT no backend usando Supabase Auth
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      console.warn('[Checkout] Requisição rejeitada: JWT inválido ou expirado.', authError?.message);
      return res.status(401).json({ error: 'Sessão inválida ou expirada. Por favor, faça login novamente.' });
    }

    // Determinar a identidade EXCLUSIVAMENTE pelo user.id do JWT validado
    const authenticatedUserId = user.id;
    const authenticatedUserEmail = user.email;

    // Se o frontend enviar profile, tratar apenas como dado não confiável e validar que não altera a identidade
    const { profile } = req.body || {};
    if (profile?.id && profile.id !== authenticatedUserId) {
      console.warn(`[Checkout] Tentativa de adulteração de identidade detectada: Auth User ID (${authenticatedUserId}) != Request Profile ID (${profile.id})`);
      return res.status(403).json({ error: 'Acesso negado: ID de perfil incompatível com o usuário autenticado.' });
    }

    try {
      // Iniciar a sessão de checkout utilizando exclusivamente os dados autenticados
      const sessionUrl = await stripeServerService.createCheckoutSession(authenticatedUserId, authenticatedUserEmail);
      console.log(`[Checkout] Sessão criada com sucesso para o usuário autenticado ${authenticatedUserId}`);
      return res.status(200).json({ url: sessionUrl });
    } catch (error: any) {
      console.error('[Checkout] Error:', error);
      return res.status(500).json({ error: error.message || 'Erro interno ao criar sessão de checkout' });
    }
  }

  // FLUXO 2: NOVO USUÁRIO GUEST (sem Bearer JWT)
  const { email, legalAccepted, turnstileToken } = req.body || {};

  // 1. Normalizar o e-mail
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return res.status(400).json({ error: 'Por favor, informe um e-mail válido.' });
  }

  // 2. Validar aceite dos termos legais
  if (!legalAccepted) {
    return res.status(400).json({ error: 'É necessário aceitar os Termos de Uso e a Política de Privacidade para continuar.' });
  }

  // 3. Validar Turnstile
  if (!turnstileToken) {
    return res.status(400).json({ error: 'Não foi possível validar a verificação de segurança (Turnstile). Tente novamente.' });
  }

  const isTurnstileValid = await verifyTurnstileToken(turnstileToken);
  if (!isTurnstileValid) {
    return res.status(400).json({ error: 'Falha na verificação de segurança (Turnstile). Por favor, tente novamente.' });
  }

  // 4. Verificar no Supabase se já existe uma conta com esse e-mail
  try {
    // A. Verificar na tabela profiles
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    // B. Verificar no Supabase Auth (auth.users)
    const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers();
    const existingAuthUser = (authUsers as any[])?.find((u: any) => u.email?.toLowerCase() === normalizedEmail);

    if (existingProfile || existingAuthUser) {
      console.warn(`[Checkout Guest] E-mail já cadastrado bloqueado: ${normalizedEmail}`);
      return res.status(400).json({
        error: 'Você já é um usuário cadastrado! Por favor, faça login e torne-se Premium acessando Ajustes / Minha Assinatura!'
      });
    }

    // 5. Se NÃO existir usuário, gerar timestamp de aceite no servidor e criar Checkout Guest
    const legalAcceptanceAt = new Date().toISOString();
    const sessionUrl = await stripeServerService.createGuestCheckoutSession(normalizedEmail, legalAcceptanceAt);

    console.log(`[Checkout Guest] Sessão de checkout guest criada com sucesso para ${normalizedEmail}`);
    return res.status(200).json({ url: sessionUrl });
  } catch (error: any) {
    console.error('[Checkout Guest] Error:', error);
    return res.status(500).json({ error: error.message || 'Erro interno ao processar a assinatura.' });
  }
}

