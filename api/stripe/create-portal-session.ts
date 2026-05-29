import { VercelRequest, VercelResponse } from '@vercel/node';
import { stripeServerService } from './stripeServerService.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[${new Date().toISOString()}] Create portal session request: ${req.method} ${req.url}`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { profile, returnUrl } = req.body;
    if (!profile) {
      console.warn('[PortalSession] Missing profile in request body');
      return res.status(400).json({ error: 'Profile is required' });
    }

    if (!returnUrl) {
      console.warn('[PortalSession] Missing returnUrl in request body');
      return res.status(400).json({ error: 'returnUrl is required' });
    }

    const portalUrl = await stripeServerService.createPortalSession(profile, returnUrl);
    console.log('[PortalSession] Session created successfully');
    res.status(200).json({ url: portalUrl });
  } catch (error: any) {
    console.error('[PortalSession] Error:', error);
    res.status(500).json({ error: error.message });
  }
}
