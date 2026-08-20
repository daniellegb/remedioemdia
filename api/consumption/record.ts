import { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateConsumptionRequest } from './_common.js';
import { atomicStockService } from '../../server/atomicStockService.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authResult = await authenticateConsumptionRequest(req, res);
  if (!authResult) return;

  const { authenticatedUserId, body } = authResult;
  const { medicationId, date, scheduledTime, status, dosageAmount, nextDoseAt } = body;

  if (!medicationId || !date || !scheduledTime) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
  }

  try {
    const result = await atomicStockService.recordConsumption({
      userId: authenticatedUserId,
      medicationId,
      date,
      scheduledTime,
      status: status || 'taken',
      dosageAmount: Number(dosageAmount) || 1,
      nextDoseAt: nextDoseAt || null,
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[API Consumption Record] Erro:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Erro ao registrar consumo' });
  }
}
