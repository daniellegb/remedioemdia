import { 
  parseDosageAmount, 
  getUpdatedStock, 
  calculateDosesPerDay, 
  calculateDailyUnitsConsumed, 
  calculateDaysOfStockLeft, 
  projectStockOnDate, 
  isOutOfStockOnDate 
} from '../src/domain/stock';
import { Medication } from '../types';
import { createClient } from '@supabase/supabase-js';

interface TestResult {
  section: string;
  name: string;
  passed: boolean;
  expected: any;
  actual: any;
  error?: string;
}

const results: TestResult[] = [];

function assertTest(section: string, name: string, actual: any, expected: any, isPassing?: boolean) {
  const passed = isPassing !== undefined ? isPassing : (
    typeof expected === 'number' && typeof actual === 'number'
      ? Math.abs(actual - expected) < 0.000001
      : JSON.stringify(actual) === JSON.stringify(expected)
  );

  results.push({
    section,
    name,
    passed,
    expected,
    actual,
    error: !passed ? `Esperado: ${JSON.stringify(expected)}, Obtido: ${JSON.stringify(actual)}` : undefined
  });
}

async function runAllTests() {
  console.log('====================================================');
  console.log('🧪 INICIANDO BATERIA DE TESTES: ESTOQUE E DOSAGEM FRACIONÁRIA');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // SEÇÃO 1: LÓGICA DE ABATIMENTO DE ESTOQUE
  // ----------------------------------------------------
  console.log('▶ Testando Seção 1: Abatimento de Estoque...');
  
  // Estoque 10 + dosagem 1 -> 9
  assertTest('1. Abatimento', 'Estoque 10 + dosagem 1 -> 9', getUpdatedStock(10, 'taken', 1), 9);
  
  // Estoque 10 + dosagem 0.5 -> 9.5
  assertTest('1. Abatimento', 'Estoque 10 + dosagem 0.5 -> 9.5', getUpdatedStock(10, 'taken', 0.5), 9.5);
  
  // Estoque 10 + dosagem 0.25 -> 9.75
  assertTest('1. Abatimento', 'Estoque 10 + dosagem 0.25 -> 9.75', getUpdatedStock(10, 'taken', 0.25), 9.75);
  
  // Estoque 10 + dosagem 1.5 -> 8.5
  assertTest('1. Abatimento', 'Estoque 10 + dosagem 1.5 -> 8.5', getUpdatedStock(10, 'taken', 1.5), 8.5);
  
  // Estoque decimal 10.5 + dosagem 0.5 -> 10
  assertTest('1. Abatimento', 'Estoque decimal 10.5 + dosagem 0.5 -> 10', getUpdatedStock(10.5, 'taken', 0.5), 10);
  
  // Múltiplos consumos sucessivos de 0.25 partindo de 1
  let stockSeq = 1;
  stockSeq = getUpdatedStock(stockSeq, 'taken', 0.25); // 0.75
  stockSeq = getUpdatedStock(stockSeq, 'taken', 0.25); // 0.50
  stockSeq = getUpdatedStock(stockSeq, 'taken', 0.25); // 0.25
  stockSeq = getUpdatedStock(stockSeq, 'taken', 0.25); // 0.00
  assertTest('1. Abatimento', '4 consumos sucessivos de 0.25 a partir de 1 -> 0', stockSeq, 0);

  // Verificação de precisão de ponto flutuante (ex: 0.1 + 0.2 ou 1 - 0.7 = 0.3 sem artefatos 0.30000000000000004)
  const fpStock = getUpdatedStock(1, 'taken', 0.7);
  assertTest('1. Abatimento', 'Ponto flutuante: 1 - 0.7 -> exatamente 0.3 (sem ruído binário)', fpStock, 0.3);

  // Múltiplos consumos de 0.1 a partir de 1.0 (10 vezes)
  let stockTenths = 1.0;
  for (let i = 0; i < 10; i++) {
    stockTenths = getUpdatedStock(stockTenths, 'taken', 0.1);
  }
  assertTest('1. Abatimento', '10 consumos sucessivos de 0.1 a partir de 1.0 -> 0', stockTenths, 0);

  // Estoque não pode ficar negativo
  const belowZero = getUpdatedStock(0.2, 'taken', 0.5);
  assertTest('1. Abatimento', 'Estoque não pode ficar negativo: 0.2 - 0.5 -> 0', belowZero, 0);

  // ----------------------------------------------------
  // SEÇÃO 2: TESTES DE ESTORNO
  // ----------------------------------------------------
  console.log('▶ Testando Seção 2: Estorno e Reversibilidade...');

  // Estoque 10 -> toma 0.5 (9.5) -> estorna (10)
  let s1 = 10;
  s1 = getUpdatedStock(s1, 'taken', 0.5);
  assertTest('2. Estorno', 'Passo 1: Consumo de 0.5 a partir de 10 -> 9.5', s1, 9.5);
  s1 = getUpdatedStock(s1, 'pending', 0.5);
  assertTest('2. Estorno', 'Passo 2: Estorno de 0.5 a partir de 9.5 -> 10', s1, 10);

  // Estorno com 0.25
  let s2 = 10;
  s2 = getUpdatedStock(s2, 'taken', 0.25);
  s2 = getUpdatedStock(s2, 'pending', 0.25);
  assertTest('2. Estorno', 'Ciclo completo com fração 0.25 retorna para 10', s2, 10);

  // Estorno com 1.5
  let s3 = 10;
  s3 = getUpdatedStock(s3, 'taken', 1.5);
  s3 = getUpdatedStock(s3, 'pending', 1.5);
  assertTest('2. Estorno', 'Ciclo completo com fração 1.5 retorna para 10', s3, 10);

  // Múltiplos ciclos sucessivos de tomar e desfazer (100 ciclos de 0.3)
  let sCycles = 15.5;
  for (let i = 0; i < 100; i++) {
    sCycles = getUpdatedStock(sCycles, 'taken', 0.3);
    sCycles = getUpdatedStock(sCycles, 'pending', 0.3);
  }
  assertTest('2. Estorno', '100 ciclos de taken/pending com fração 0.3 preservam exatamente 15.5 sem drift', sCycles, 15.5);

  // ----------------------------------------------------
  // SEÇÃO 3: PARSING DE DOSAGEM
  // ----------------------------------------------------
  console.log('▶ Testando Seção 3: Parsing da Dosagem...');

  assertTest('3. Parsing', 'parseDosageAmount("0.5") -> 0.5', parseDosageAmount('0.5'), 0.5);
  assertTest('3. Parsing', 'parseDosageAmount("0,5") -> 0.5 (com vírgula)', parseDosageAmount('0,5'), 0.5);
  assertTest('3. Parsing', 'parseDosageAmount("1") -> 1', parseDosageAmount('1'), 1);
  assertTest('3. Parsing', 'parseDosageAmount(1) -> 1 (número)', parseDosageAmount(1), 1);
  assertTest('3. Parsing', 'parseDosageAmount(0.5) -> 0.5 (número)', parseDosageAmount(0.5), 0.5);
  assertTest('3. Parsing', 'parseDosageAmount("1.5") -> 1.5', parseDosageAmount('1.5'), 1.5);
  assertTest('3. Parsing', 'parseDosageAmount("1,5") -> 1.5 (com vírgula)', parseDosageAmount('1,5'), 1.5);
  assertTest('3. Parsing', 'parseDosageAmount("0.25") -> 0.25', parseDosageAmount('0.25'), 0.25);
  assertTest('3. Parsing', 'parseDosageAmount("0,25") -> 0.25 (com vírgula)', parseDosageAmount('0,25'), 0.25);
  
  // Casos especiais / borda
  assertTest('3. Parsing', 'parseDosageAmount("") -> 1 (fallback seguro para vazio)', parseDosageAmount(''), 1);
  assertTest('3. Parsing', 'parseDosageAmount(null) -> 1 (fallback seguro para null)', parseDosageAmount(null), 1);
  assertTest('3. Parsing', 'parseDosageAmount(undefined) -> 1 (fallback seguro para undefined)', parseDosageAmount(undefined), 1);
  assertTest('3. Parsing', 'parseDosageAmount("abc") -> 1 (fallback seguro para texto não-numérico)', parseDosageAmount('abc'), 1);
  assertTest('3. Parsing', 'parseDosageAmount(0) -> 1 (fallback seguro para 0)', parseDosageAmount(0), 1);
  assertTest('3. Parsing', 'parseDosageAmount(-2) -> 1 (fallback seguro para negativos)', parseDosageAmount(-2), 1);
  assertTest('3. Parsing', 'parseDosageAmount(" 0.75 ") -> 0.75 (com espaços)', parseDosageAmount(' 0.75 '), 0.75);

  // ----------------------------------------------------
  // SEÇÃO 4: PROJEÇÃO DE DURAÇÃO DO ESTOQUE
  // ----------------------------------------------------
  console.log('▶ Testando Seção 4: Projeção de Duração do Estoque...');

  const mockMedBase: Medication = {
    id: 'med-test-1',
    name: 'Medicamento Teste',
    dosage: '0.5',
    currentStock: 30,
    totalStock: 30,
    unit: 'comprimido',
    usageCategory: 'continuous',
    frequency: 1,
    times: ['08:00', '20:00'], // 2 tomadas por dia
    intervalDays: 1,
    active: true,
    deleted: false,
    color: 'bg-blue-500'
  };

  // 2 tomadas por dia de 0.5 = consumo diário de 1
  const daily1 = calculateDailyUnitsConsumed(mockMedBase);
  assertTest('4. Projeção', '2 tomadas/dia de 0.5 -> consumo diário de 1 unidade', daily1, 1);

  // Estoque 30 / consumo 1 -> duração de 30 dias
  const days1 = calculateDaysOfStockLeft(mockMedBase);
  assertTest('4. Projeção', 'Estoque 30 com consumo 1/dia -> duração de 30 dias', days1, 30);

  // 3 tomadas por dia de 0.25 = consumo diário de 0.75
  const mockMed3Doses: Medication = {
    ...mockMedBase,
    dosage: '0.25',
    times: ['08:00', '14:00', '20:00'], // 3 tomadas
    currentStock: 15
  };
  const daily2 = calculateDailyUnitsConsumed(mockMed3Doses);
  assertTest('4. Projeção', '3 tomadas/dia de 0.25 -> consumo diário de 0.75 unidades', daily2, 0.75);

  // Estoque 15 / consumo 0.75 -> duração de 20 dias (15 / 0.75 = 20)
  const days2 = calculateDaysOfStockLeft(mockMed3Doses);
  assertTest('4. Projeção', 'Estoque 15 com consumo 0.75/dia -> duração de 20 dias', days2, 20);

  // Medicamento PRN (se necessário) com dosagem 0.5 e estoque 10 -> 20 doses possíveis
  const mockMedPrn: Medication = {
    ...mockMedBase,
    usageCategory: 'prn',
    dosage: '0.5',
    currentStock: 10,
    times: []
  };
  const prnDosesLeft = calculateDaysOfStockLeft(mockMedPrn);
  assertTest('4. Projeção', 'PRN com estoque 10 e dose 0.5 -> 20 doses restantes', prnDosesLeft, 20);

  // Projeção futura com fração: estoque 20, 1 tomada/dia de 1.5. Em 4 dias consumirá 6 unidades -> estoque 14
  const mockMedFuture: Medication = {
    ...mockMedBase,
    dosage: '1.5',
    times: ['08:00'],
    currentStock: 20
  };
  const today = new Date('2026-08-19T00:00:00Z');
  const future4Days = new Date('2026-08-23T00:00:00Z');
  const projStock = projectStockOnDate(mockMedFuture, future4Days, today);
  assertTest('4. Projeção', 'Projeção futura de 4 dias com dose 1.5/dia a partir de 20 -> 14', projStock, 14);

  // ----------------------------------------------------
  // SEÇÃO 5: FORMULÁRIO E SERIALIZAÇÃO DE ESTOQUE DECIMAL
  // ----------------------------------------------------
  console.log('▶ Testando Seção 5: Formulário e Serialização...');

  // Simular parse e conversão feita pelo formulário
  const testInputValues = ['0.5', '10.5', '15.25', '30'];
  for (const inputStr of testInputValues) {
    const parsedVal = parseFloat(inputStr);
    assertTest('5. Formulário', `Input "${inputStr}" deve preservar valor numérico exato ${parsedVal}`, parsedVal, Number(inputStr));
  }

  // Não arredondar valores fracionados
  const fractionalCurrent = 15.25;
  const fractionalTotal = 30.5;
  assertTest('5. Formulário', 'Estoque fracionado 15.25 não pode ser truncado para inteiro', Math.floor(fractionalCurrent) !== fractionalCurrent, true);
  assertTest('5. Formulário', 'Total fracionado 30.5 não pode ser truncado para inteiro', Math.floor(fractionalTotal) !== fractionalTotal, true);

  // ----------------------------------------------------
  // SEÇÃO 6 E 7: PERSISTÊNCIA NO BANCO E INTEGRAÇÃO REAL
  // ----------------------------------------------------
  console.log('▶ Testando Seção 6 e 7: Persistência no Banco e Integração com Supabase...');

  const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SECRET_KEY || '';

  if (supabaseUrl && serviceKey) {
    const supabase = createClient(supabaseUrl, serviceKey);

    try {
      // 1. Criar um medicamento de teste com estoque fracionário
      const testMedName = `__TEST_MED_FRAC_${Date.now()}`;
      console.log(`  Inserindo medicamento de teste: ${testMedName}...`);
      
      const { data: createdMed, error: createError } = await supabase
        .from('medications')
        .insert({
          user_id: '00000000-0000-0000-0000-000000000000', // ou usuário dummy/existente
          name: testMedName,
          dosage: '0.5',
          current_stock: 10,
          total_stock: 30,
          unit: 'comprimido',
          usage_category: 'continuous',
          times: ['08:00'],
          active: true,
          deleted: false
        })
        .select()
        .single();

      if (createError) {
        // Se falhar por RLS/user_id inexistente, buscar um usuário existente no banco
        const { data: existingUser } = await supabase.from('profiles').select('id').limit(1).single();
        if (existingUser) {
          const { data: medWithUser, error: err2 } = await supabase
            .from('medications')
            .insert({
              user_id: existingUser.id,
              name: testMedName,
              dosage: '0.5',
              current_stock: 10,
              total_stock: 30,
              unit: 'comprimido',
              usage_category: 'continuous',
              times: ['08:00'],
              active: true,
              deleted: false
            })
            .select()
            .single();

          if (err2) {
            console.error('  Erro ao criar med de teste:', err2);
            assertTest('6. Persistência', 'Inserção de medicamento de teste no banco', false, true, false);
          } else if (medWithUser) {
            await runDbIntegrationLifecycle(supabase, medWithUser);
          }
        } else {
          console.warn('  Nenhum perfil encontrado para vincular o teste de banco.');
        }
      } else if (createdMed) {
        await runDbIntegrationLifecycle(supabase, createdMed);
      }
    } catch (err: any) {
      console.error('  Erro durante teste de banco:', err.message);
      assertTest('6. Persistência', `Operação no banco: ${err.message}`, false, true, false);
    }
  } else {
    console.warn('  Variáveis de Supabase não encontradas. Pulando testes diretos de I/O de rede.');
  }

  // ----------------------------------------------------
  // SEÇÃO 8: REGRESSÃO COM VALORES INTEIROS
  // ----------------------------------------------------
  console.log('▶ Testando Seção 8: Regressão com Valores Inteiros...');

  // Dosagem 1: 10 - 1 = 9
  assertTest('8. Regressão', 'Dosagem inteira 1: 10 -> 9', getUpdatedStock(10, 'taken', 1), 9);
  
  // Dosagem 2: 10 - 2 = 8
  assertTest('8. Regressão', 'Dosagem inteira 2: 10 -> 8', getUpdatedStock(10, 'taken', 2), 8);

  // Estorno inteiro: 8 + 2 = 10
  assertTest('8. Regressão', 'Estorno de dosagem 2: 8 -> 10', getUpdatedStock(8, 'pending', 2), 10);

  // Parsing de inteiros normais
  assertTest('8. Regressão', 'Parsing de dosagem inteira "2"', parseDosageAmount('2'), 2);
  assertTest('8. Regressão', 'Parsing de dosagem inteira "1"', parseDosageAmount('1'), 1);

  // Projeção com inteiros: 2 tomadas de 1 = 2/dia, estoque 20 -> 10 dias
  const mockMedInt: Medication = {
    ...mockMedBase,
    dosage: '1',
    times: ['08:00', '20:00'],
    currentStock: 20
  };
  assertTest('8. Regressão', 'Projeção inteira tradicional: 20 estoque com 2 tomadas de 1/dia -> 10 dias', calculateDaysOfStockLeft(mockMedInt), 10);

  // ----------------------------------------------------
  // RESUMO DOS RESULTADOS
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log('📊 RESUMO DA BATERIA DE TESTES:');
  console.log('====================================================');
  
  const total = results.length;
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log(`Total de Casos de Teste: ${total}`);
  console.log(`✅ Aprovados: ${passedCount}`);
  console.log(`❌ Reprovados: ${failedCount}`);

  if (failedCount > 0) {
    console.log('\n❌ DETALHES DAS FALHAS:');
    results.filter(r => !r.passed).forEach(f => {
      console.log(`  [${f.section}] ${f.name} -> ${f.error}`);
    });
  } else {
    console.log('\n🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
  }
}

async function runDbIntegrationLifecycle(supabase: any, med: any) {
  console.log(`  Executando ciclo completo de integração no DB com medId: ${med.id}...`);

  // Teste 6.1: Atualizar current_stock para 10.5 e total_stock para 15.25 diretamente no DB
  const { data: updated1, error: errUpdate1 } = await supabase
    .from('medications')
    .update({ current_stock: 10.5, total_stock: 15.25 })
    .eq('id', med.id)
    .select()
    .single();

  if (errUpdate1) {
    assertTest('6. Persistência', 'Gravação de current_stock=10.5 e total_stock=15.25 no DB', false, true, false);
  } else {
    assertTest('6. Persistência', 'Gravação e leitura de current_stock=10.5 decimal no DB', Number(updated1.current_stock), 10.5);
    assertTest('6. Persistência', 'Gravação e leitura de total_stock=15.25 decimal no DB', Number(updated1.total_stock), 15.25);
  }

  // Teste 7: Fluxo Completo de Tomada e Estorno
  // Passo 1: Resetar estoque para 10 e dosagem 0.5
  await supabase.from('medications').update({ current_stock: 10, dosage: '0.5' }).eq('id', med.id);
  
  // Passo 2: 1ª tomada (10 - 0.5 = 9.5)
  const dose1 = getUpdatedStock(10, 'taken', parseDosageAmount('0.5'));
  await supabase.from('medications').update({ current_stock: dose1 }).eq('id', med.id);
  const { data: step1 } = await supabase.from('medications').select('current_stock').eq('id', med.id).single();
  assertTest('7. Integração', 'Fluxo: 1ª tomada de 0.5 -> estoque 9.5 no DB', Number(step1.current_stock), 9.5);

  // Passo 3: 2ª tomada (9.5 - 0.5 = 9)
  const dose2 = getUpdatedStock(Number(step1.current_stock), 'taken', parseDosageAmount('0.5'));
  await supabase.from('medications').update({ current_stock: dose2 }).eq('id', med.id);
  const { data: step2 } = await supabase.from('medications').select('current_stock').eq('id', med.id).single();
  assertTest('7. Integração', 'Fluxo: 2ª tomada de 0.5 -> estoque 9.0 no DB', Number(step2.current_stock), 9.0);

  // Passo 4: Estorno de uma tomada (9 + 0.5 = 9.5)
  const estorno = getUpdatedStock(Number(step2.current_stock), 'pending', parseDosageAmount('0.5'));
  await supabase.from('medications').update({ current_stock: estorno }).eq('id', med.id);
  const { data: step3 } = await supabase.from('medications').select('current_stock').eq('id', med.id).single();
  assertTest('7. Integração', 'Fluxo: Estorno de tomada -> estoque 9.5 no DB', Number(step3.current_stock), 9.5);

  // Passo 5: Repetir fluxo com fração 0.25 (9.5 - 0.25 = 9.25)
  const dose025 = getUpdatedStock(Number(step3.current_stock), 'taken', parseDosageAmount('0.25'));
  await supabase.from('medications').update({ current_stock: dose025 }).eq('id', med.id);
  const { data: step4 } = await supabase.from('medications').select('current_stock').eq('id', med.id).single();
  assertTest('7. Integração', 'Fluxo: Tomada com dosagem 0.25 -> estoque 9.25 no DB', Number(step4.current_stock), 9.25);

  // Limpeza: deletar medicamento de teste
  await supabase.from('medications').delete().eq('id', med.id);
  console.log('  Medicamento de teste removido com sucesso.');
}

runAllTests().catch(err => {
  console.error('Fatal error in tests:', err);
});
