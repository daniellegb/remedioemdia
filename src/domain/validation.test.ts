import {
  HH_MM_REGEX,
  validateTimeFormat,
  validateOptionalTimeFormat,
  validateStringLength,
  validateStockNumber
} from './validation';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function assertThrows(fn: () => void, expectedMessageSubstr?: string) {
  let threw = false;
  try {
    fn();
  } catch (err: any) {
    threw = true;
    if (expectedMessageSubstr && !err.message.includes(expectedMessageSubstr)) {
      throw new Error(`Expected error message containing "${expectedMessageSubstr}", but got "${err.message}"`);
    }
  }
  if (!threw) {
    throw new Error('Expected function to throw, but it succeeded.');
  }
}

console.log('--- EXECUTANDO TESTES UNITÁRIOS DE VALIDAÇÃO ---');

// 1. Horários válidos
console.log('1. Testando horários válidos...');
assert(validateTimeFormat('09:00') === '09:00', '09:00 deve ser válido');
assert(validateTimeFormat('12:30') === '12:30', '12:30 deve ser válido');
assert(validateTimeFormat('23:59') === '23:59', '23:59 deve ser válido');
assert(validateTimeFormat('00:00') === '00:00', '00:00 deve ser válido');
assert(validateTimeFormat('  14:45  ') === '14:45', '14:45 com trim deve ser válido');

// 2. Horários inválidos
console.log('2. Testando horários inválidos...');
assertThrows(() => validateTimeFormat('9:00'), 'formato deve ser HH:MM');
assertThrows(() => validateTimeFormat('24:00'), 'formato deve ser HH:MM');
assertThrows(() => validateTimeFormat('12:60'), 'formato deve ser HH:MM');
assertThrows(() => validateTimeFormat('12:30:00'), 'formato deve ser HH:MM');
assertThrows(() => validateTimeFormat('abc'), 'formato deve ser HH:MM');
assertThrows(() => validateTimeFormat(''), 'é obrigatório');
assertThrows(() => validateTimeFormat('   '), 'é obrigatório');
assertThrows(() => validateTimeFormat(null as any), 'é obrigatório');
assert(validateOptionalTimeFormat(null) === null, 'Opcional nulo deve retornar null');
assert(validateOptionalTimeFormat('') === null, 'Opcional vazio deve retornar null');

// 3. Validação de Strings
console.log('3. Testando validação de strings...');
assert(validateStringLength('  Paracetamol  ', 'Nome', 100, true) === 'Paracetamol', 'Trim em string válida');
assert(validateStringLength('A'.repeat(100), 'Nome', 100, true) === 'A'.repeat(100), 'String no limite exato');
assertThrows(() => validateStringLength('A'.repeat(101), 'Nome', 100, false), 'deve ter no máximo 100 caracteres');
assertThrows(() => validateStringLength('', 'Nome', 100, true), 'é obrigatório');
assert(validateStringLength('', 'Observações', 500, false) === null, 'Opcional vazio deve retornar null');

// 4. Validação de Estoque
console.log('4. Testando números de estoque...');
assert(validateStockNumber(10, 'Estoque') === 10, '10 é válido');
assert(validateStockNumber(0, 'Estoque') === 0, '0 é válido');
assert(validateStockNumber('25', 'Estoque') === 25, 'String "25" é convertida');
assertThrows(() => validateStockNumber(-1, 'Estoque'), 'não pode ser negativo');
assertThrows(() => validateStockNumber(NaN, 'Estoque'), 'deve ser um número válido');
assertThrows(() => validateStockNumber(Infinity, 'Estoque'), 'deve ser um número válido');
assertThrows(() => validateStockNumber(2000000, 'Estoque', 1000000), 'não pode ser maior');
assertThrows(() => validateStockNumber('abc', 'Estoque'), 'deve ser um número válido');

console.log('✅ TODOS OS TESTES UNITÁRIOS DE VALIDAÇÃO PASSARAM COM SUCESSO!');
