import { VercelRequest, VercelResponse } from '@vercel/node';
import { stripeServerService } from './stripeServerService';

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
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] WEBHOOK HIT - Method: ${req.method} - URL: ${req.url}`);

  if (req.method !== 'POST') {
    console.warn(`[${timestamp}] [Webhook] Method ${req.method} not allowed. Expecting POST.`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  console.log(`[${timestamp}] [Webhook] Signature Exists: ${!!sig}`);

  if (!sig) {
    console.error(`[${timestamp}] [Webhook] Missing stripe-signature header`);
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  try {
    const rawBody = await getRawBody(req);
    console.log(`[${timestamp}] [Webhook] Raw body length: ${rawBody.length} bytes`);
    
    await stripeServerService.handleWebhook(sig as string, rawBody);
    
    console.log(`[${timestamp}] [Webhook] Event processed successfully`);
    res.status(200).json({ received: true });
  } catch (err: any) {
    console.error(`[${timestamp}] [Webhook] Error: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
}
