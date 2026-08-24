import { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateConsumptionRequest } from './_common.js';
import { atomicStockService } from '../../server/atomicStockService.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authResult = await authenticateConsumptionRequest(req, res);
  if (!authResult) return;

  const { authenticatedUserId, body } = authResult;
  const { recordId, dosageAmount } = body;

  if (!recordId) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
  }

  try {
    const result = await atomicStockService.deleteConsumption({
      userId: authenticatedUserId,
      recordId,
      dosageAmount: Number(dosageAmount) || 1,
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[API Consumption Delete] Erro:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Erro ao excluir consumo' });
  }
}
