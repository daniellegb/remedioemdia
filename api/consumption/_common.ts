import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

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
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || 'placeholder_key');

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
