import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY || '';

function getMatchingSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    return url;
  }
  throw new Error('[Supabase Config Error] URL HTTP/HTTPS do Supabase não configurada. Defina SUPABASE_URL ou VITE_SUPABASE_URL.');
}

const supabaseUrl = getMatchingSupabaseUrl();
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export interface AuthenticatedRequestResult {
  authenticatedUserId: string;
  body: any;
}

/**
 * Common middleware/utility function to authenticate requests and prevent userId spoofing.
 * Returns { authenticatedUserId, body } if valid, or sends error response and returns null.
 */
export async function authenticateConsumptionRequest(
  req: VercelRequest,
  res: VercelResponse
): Promise<AuthenticatedRequestResult | null> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return null;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Nenhum token de autorização fornecido.' });
    return null;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Token de autorização em branco.' });
    return null;
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    res.status(401).json({ error: 'Sessão inválida ou expirada. Por favor, faça login novamente.' });
    return null;
  }

  const authenticatedUserId = user.id;
  const body = req.body || {};

  // Spoofing check: if userId was provided in body, ensure it matches authenticated user
  if (body.userId && body.userId !== authenticatedUserId) {
    res.status(403).json({ error: 'Acesso negado: o userId fornecido não corresponde ao usuário autenticado.' });
    return null;
  }

  return { authenticatedUserId, body };
}
