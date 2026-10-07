import {
  HH_MM_REGEX,
  validateTimeFormat,
  validateOptionalTimeFormat,
  validateStringLength,
  validateStockNumber,
  validateAlphanumericText,
<<<<<<< HEAD
  validateAddressText
=======
  validateAddressText,
  validateEmailText
>>>>>>> dev
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

// 5. Validação Alfanumérica (Segurança & Injeção)
console.log('5. Testando validação de texto alfanumérico (letras e números)...');
assert(validateAlphanumericText('Paracetamol 500mg', 'Nome do medicamento', 100, true) === 'Paracetamol 500mg', 'Nome válido com letras e números');
assert(validateAlphanumericText('Dr Armando 123', 'Médico', 100, false) === 'Dr Armando 123', 'Médico válido com acentos e números');
assert(validateAlphanumericText('Cardiologia', 'Especialidade', 100, false) === 'Cardiologia', 'Especialidade válida');
assert(validateAlphanumericText('Lab Labor 2', 'Local', 200, false) === 'Lab Labor 2', 'Local válido');
assert(validateAlphanumericText('Instrução sem pontuação extra', 'Observações', 500, false) === 'Instrução sem pontuação extra', 'Observações válidas');

// Rejeição de caracteres proibidos (ex: /, -, <, >, ;, ', ", etc.)
assertThrows(() => validateAlphanumericText('Paracetamol / Dipirona', 'Nome do medicamento', 100, true), 'deve conter apenas caracteres de texto e números');
assertThrows(() => validateAlphanumericText('Remédio - 10mg', 'Nome do medicamento', 100, true), 'deve conter apenas caracteres de texto e números');
assertThrows(() => validateAlphanumericText('Dr. Armando', 'Médico', 100, false), 'deve conter apenas caracteres de texto e números');
assertThrows(() => validateAlphanumericText('<script>alert("xss")</script>', 'Nome do medicamento', 100, true), 'deve conter apenas caracteres de texto e números');
assertThrows(() => validateAlphanumericText("SELECT * FROM users;", 'Observações', 500, false), 'deve conter apenas caracteres de texto e números');

// 6. Validação de Endereço (Texto, Números, Vírgulas, Pontos, Ordinais)
console.log('6. Testando validação de campo de endereço...');
assert(validateAddressText('Av Paulista 1000, Sao Paulo', 'Endereço', 200, false) === 'Av Paulista 1000, Sao Paulo', 'Endereço válido com vírgula');
assert(validateAddressText('Rua das Flores, 123. Apto 45, 2º andar', 'Endereço', 200, false) === 'Rua das Flores, 123. Apto 45, 2º andar', 'Endereço válido com ponto e ordinal º');
assert(validateAddressText('2ª Travessa da Paz, nº 10', 'Endereço', 200, false) === '2ª Travessa da Paz, nº 10', 'Endereço válido com ordinal ª e nº');
assert(validateAddressText('  Rua Central 50  ', 'Endereço', 200, false) === 'Rua Central 50', 'Endereço válido com trim');

// Rejeição de caracteres não permitidos em endereço (ex: /, -, <, >, ;, ', ", etc.)
assertThrows(() => validateAddressText('Av Paulista / Rua Augusta', 'Endereço', 200, false), 'Caracteres como /, -, <, > não são permitidos');
assertThrows(() => validateAddressText('Rua das Flores - 123', 'Endereço', 200, false), 'Caracteres como /, -, <, > não são permitidos');
assertThrows(() => validateAddressText('<script>alert("xss")</script>', 'Endereço', 200, false), 'Caracteres como /, -, <, > não são permitidos');
assertThrows(() => validateAddressText("SELECT * FROM address WHERE '1'='1';", 'Endereço', 200, false), 'Caracteres como /, -, <, > não são permitidos');

<<<<<<< HEAD
=======
// 7. Validação de E-mail (Segurança & Prevenção de Injeção)
console.log('7. Testando validação de campo de e-mail...');
assert(validateEmailText('usuario@dominio.com', 'E-mail', true) === 'usuario@dominio.com', 'E-mail simples válido');
assert(validateEmailText('NOME.SOBRENOME+TAG@Sub.Domain.com.br', 'E-mail', true) === 'nome.sobrenome+tag@sub.domain.com.br', 'E-mail complexo com maiúsculas convertido para minúsculas');
assert(validateEmailText('  user123_test%foo-bar@example.org  ', 'E-mail', true) === 'user123_test%foo-bar@example.org', 'E-mail com símbolos válidos e trim');

// Rejeição de ataques de injeção e caracteres proibidos
assertThrows(() => validateEmailText('<script>alert("xss")</script>@test.com', 'E-mail', true), 'Apenas letras, números e os símbolos ., _, %, +, -, @ são permitidos');
assertThrows(() => validateEmailText("admin' OR '1'='1", 'E-mail', true), 'Apenas letras, números e os símbolos ., _, %, +, -, @ são permitidos');
assertThrows(() => validateEmailText('user@domain.com; DROP TABLE users;', 'E-mail', true), 'Apenas letras, números e os símbolos ., _, %, +, -, @ são permitidos');
assertThrows(() => validateEmailText('user/test@domain.com', 'E-mail', true), 'Apenas letras, números e os símbolos ., _, %, +, -, @ são permitidos');
assertThrows(() => validateEmailText('user"test"@domain.com', 'E-mail', true), 'Apenas letras, números e os símbolos ., _, %, +, -, @ são permitidos');

// Rejeição de formatos inválidos
assertThrows(() => validateEmailText('usuario@dominio', 'E-mail', true), 'Informe um e-mail no formato nome@dominio.com');
assertThrows(() => validateEmailText('usuario@@dominio.com', 'E-mail', true), 'Informe um e-mail no formato nome@dominio.com');
assertThrows(() => validateEmailText('@dominio.com', 'E-mail', true), 'Informe um e-mail no formato nome@dominio.com');
assertThrows(() => validateEmailText('', 'E-mail', true), 'E-mail é obrigatório');

>>>>>>> dev
console.log('✅ TODOS OS TESTES UNITÁRIOS DE VALIDAÇÃO PASSARAM COM SUCESSO!');
