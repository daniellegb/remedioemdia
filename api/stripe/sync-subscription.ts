import { VercelRequest, VercelResponse } from '@vercel/node';
import { stripeServerService } from './stripeServerService.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[${new Date().toISOString()}] Sync subscription request: ${req.method} ${req.url}`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.body;
    if (!userId) {
      console.warn('[SyncSubscription] Missing userId in request body');
      return res.status(400).json({ error: 'userId is required' });
    }

    const syncedProfile = await stripeServerService.syncSubscription(userId);
    console.log('[SyncSubscription] Subscription synced successfully for user:', userId);
    res.status(200).json({ profile: syncedProfile });
  } catch (error: any) {
    console.error('[SyncSubscription] Error:', error);
    res.status(500).json({ error: error.message });
  }
}
