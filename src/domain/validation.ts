export const HH_MM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Valida se uma string de horário está estritamente no formato HH:MM (00:00 a 23:59).
 * Lança exceção se inválida.
 */
export function validateTimeFormat(
  time: string | null | undefined,
  fieldName: string = 'Horário'
): string {
  if (time === undefined || time === null || typeof time !== 'string' || time.trim() === '') {
    throw new Error(`${fieldName} é obrigatório.`);
  }

  const trimmed = time.trim();

  if (!HH_MM_REGEX.test(trimmed)) {
    throw new Error(`${fieldName} inválido (${time}). O formato deve ser HH:MM (de 00:00 a 23:59).`);
  }

  return trimmed;
}

/**
 * Valida horário opcional. Retorna null se não informado.
 */
export function validateOptionalTimeFormat(
  time: string | null | undefined,
  fieldName: string = 'Horário'
): string | null {
  if (time === undefined || time === null || (typeof time === 'string' && time.trim() === '')) {
    return null;
  }
  return validateTimeFormat(time, fieldName);
}

/**
 * Aplica trim e valida limites de tamanho em campos de texto.
 * Lança erro se o tamanho exceder o limite máximo ou se for obrigatório e estiver vazio.
 */
export function validateStringLength(
  value: string | null | undefined,
  fieldName: string,
  maxLength: number,
  required: boolean = false
): string | null {
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${fieldName} é obrigatório.`);
    }
    return null;
  }

  const trimmed = typeof value === 'string' ? value.trim() : String(value).trim();

  if (trimmed === '') {
    if (required) {
      throw new Error(`${fieldName} é obrigatório.`);
    }
    return null;
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} deve ter no máximo ${maxLength} caracteres.`);
  }

  return trimmed;
}

/**
 * Valida números de estoque (currentStock, totalStock).
 * Rejeita NaN, Infinity, valores negativos e acima de maxStock.
 */
export function validateStockNumber(
  value: number | string | null | undefined,
  fieldName: string,
  maxStock: number = 1000000
): number {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${fieldName} é obrigatório.`);
  }

  const num = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(num)) {
    throw new Error(`${fieldName} deve ser um número válido.`);
  }

  if (num < 0) {
    throw new Error(`${fieldName} não pode ser negativo.`);
  }

  if (num > maxStock) {
    throw new Error(`${fieldName} não pode ser maior que ${maxStock}.`);
  }

  return num;
}
