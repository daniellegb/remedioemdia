import { VercelRequest, VercelResponse } from '@vercel/node';
import { stripeService } from '../../src/services/stripeService';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[${new Date().toISOString()}] Webhook received: ${req.method} ${req.url}`);

  if (req.method !== 'POST') {
    console.warn(`[Webhook] Method ${req.method} not allowed`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    console.error('[Webhook] Missing stripe-signature header');
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  try {
    const rawBody = await getRawBody(req);
    await stripeService.handleWebhook(sig as string, rawBody);
    console.log('[Webhook] Event processed successfully');
    res.status(200).json({ received: true });
  } catch (err: any) {
    console.error(`[Webhook] Error: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
}
