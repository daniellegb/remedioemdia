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
 * Valida e sanitiza campos de texto permitindo exclusivamente letras (incluindo acentuadas),
 * números e espaços. Rejeita qualquer outro caractere como /, -, <, >, ;, ', ", etc.,
 * aumentando a segurança contra ataques de injeção.
 */
export function validateAlphanumericText(
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

  const str = typeof value === 'string' ? value : String(value);
  const trimmed = str.trim();

  if (trimmed === '') {
    if (required) {
      throw new Error(`${fieldName} é obrigatório.`);
    }
    return null;
  }

  const hasForbiddenChars = /[^\p{L}\p{N}\s]/u.test(trimmed);
  if (hasForbiddenChars) {
    throw new Error(`${fieldName} deve conter apenas caracteres de texto e números. Caracteres especiais como /, -, <, > não são permitidos.`);
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} deve ter no máximo ${maxLength} caracteres.`);
  }

  return trimmed;
}

/**
 * Valida e sanitiza campo de endereço permitindo exclusivamente letras (incluindo acentuadas),
 * números, espaços e caracteres fundamentais de endereço (vírgula ,, ponto ., e símbolos ordinais º e ª).
 * Rejeita qualquer outro caractere como /, -, <, >, ;, ', ", etc., aumentando a segurança contra ataques de injeção.
 */
export function validateAddressText(
  value: string | null | undefined,
  fieldName: string = 'Endereço',
  maxLength: number = 200,
  required: boolean = false
): string | null {
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${fieldName} é obrigatório.`);
    }
    return null;
  }

  const str = typeof value === 'string' ? value : String(value);
  const trimmed = str.trim();

  if (trimmed === '') {
    if (required) {
      throw new Error(`${fieldName} é obrigatório.`);
    }
    return null;
  }

  const hasForbiddenChars = /[^\p{L}\p{N}\s,.\u00BA\u00AA]/u.test(trimmed);
  if (hasForbiddenChars) {
    throw new Error(`${fieldName} deve conter apenas letras, números e caracteres fundamentais de endereço (, . º ª). Caracteres como /, -, <, > não são permitidos.`);
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} deve ter no máximo ${maxLength} caracteres.`);
  }

  return trimmed;
}

/**
<<<<<<< HEAD
=======
 * Valida e sanitiza campo de e-mail permitindo exclusivamente caracteres válidos de e-mail
 * (letras, números e os símbolos ., _, %, +, -, @).
 * Rejeita qualquer outro caractere especial (como /, <, >, ;, ', ", \, (, ), {, }, etc.)
 * e valida a estrutura formal do e-mail (nome@dominio.com), garantindo proteção contra ataques de injeção.
 */
export function validateEmailText(
  value: string | null | undefined,
  fieldName: string = 'E-mail',
  required: boolean = true
): string {
  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${fieldName} é obrigatório.`);
    }
    return '';
  }

  const str = typeof value === 'string' ? value : String(value);
  const trimmed = str.trim();

  if (trimmed === '') {
    if (required) {
      throw new Error(`${fieldName} é obrigatório.`);
    }
    return '';
  }

  // Verificar se há caracteres proibidos fora do padrão seguro de e-mail
  const hasForbiddenChars = /[^a-zA-Z0-9._%+\-@]/;
  if (hasForbiddenChars.test(trimmed)) {
    throw new Error(`${fieldName} contém caracteres inválidos. Apenas letras, números e os símbolos ., _, %, +, -, @ são permitidos. Caracteres especiais como <, >, /, ;, ', " não são permitidos.`);
  }

  // Limite de tamanho conforme RFC 5321 (máximo 254 caracteres)
  if (trimmed.length > 254) {
    throw new Error(`${fieldName} deve ter no máximo 254 caracteres.`);
  }

  // Validação estrita do formato do e-mail
  const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!EMAIL_REGEX.test(trimmed)) {
    throw new Error(`${fieldName} inválido. Informe um e-mail no formato nome@dominio.com.`);
  }

  return trimmed.toLowerCase();
}

/**
>>>>>>> dev
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
