import { VercelRequest, VercelResponse } from '@vercel/node';
import { stripeServerService } from '../../server/services/stripeServerService';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[${new Date().toISOString()}] Checkout request: ${req.method} ${req.url}`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { profile } = req.body;
    if (!profile) {
      console.warn('[Checkout] Missing profile in request body');
      return res.status(400).json({ error: 'Profile is required' });
    }

    const sessionUrl = await stripeServerService.createCheckoutSession(profile);
    console.log('[Checkout] Session created successfully');
    res.status(200).json({ url: sessionUrl });
  } catch (error: any) {
    console.error('[Checkout] Error:', error);
    res.status(500).json({ error: error.message });
  }
}
