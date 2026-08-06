import React, { useState, useEffect } from 'react';
import { ArrowLeft, Shield, Download, FileText, CheckCircle2, AlertTriangle, Clock, Calendar, CheckSquare, Square, FileDown } from 'lucide-react';
import { useAuth } from '../src/hooks/useAuth';
import { ViewType } from '../types';
import { motion } from 'motion/react';
import { supabase } from '../src/lib/supabase';
import { medicationService } from '../src/services/medicationService';
import { reportService, formatUnit } from '../src/services/report';

interface Props {
  setView: (view: ViewType) => void;
  initialShowReportConfig?: boolean;
  onResetReportConfig?: () => void;
  onBackToPrevious?: () => void;
}

const Privacy: React.FC<Props> = ({ setView, initialShowReportConfig, onResetReportConfig, onBackToPrevious }) => {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);

  // States for medications and consumption records loaded from DB
  const [medications, setMedications] = useState<any[]>([]);
  const [consumptionRecords, setConsumptionRecords] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(false);

  // States for report config
  const [showReportConfig, setShowReportConfig] = useState(initialShowReportConfig ?? false);

  useEffect(() => {
    if (initialShowReportConfig !== undefined) {
      setShowReportConfig(initialShowReportConfig);
    }
  }, [initialShowReportConfig]);
  const [periodOption, setPeriodOption] = useState<'7' | '30' | '90' | 'all' | 'custom'>('30');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [medsSelection, setMedsSelection] = useState<'all' | 'specific'>('all');
  const [selectedMeds, setSelectedMeds] = useState<string[]>([]);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  // Fetch medications and records on user mount/change
  useEffect(() => {
    if (!user) return;
    const loadData = async () => {
      setDbLoading(true);
      try {
        const [meds, records] = await Promise.all([
          medicationService.getMedications(user.id).catch(() => []),
          supabase.from('consumption_records').select('*').eq('user_id', user.id).order('date', { ascending: false })
        ]);
        setMedications(meds);
        if (records.data) {
          setConsumptionRecords(records.data);
        }
      } catch (err) {
        console.error('Error loading privacy data:', err);
      } finally {
        setDbLoading(false);
      }
    };
    loadData();
  }, [user]);

  const handleGenerateReport = async () => {
    if (!user) {
      setError('Você precisa estar autenticado para gerar o relatório.');
      return;
    }

    setReportGenerating(true);
    setReportSuccess(false);
    setError(null);

    try {
      await reportService.generateHistoryReport({
        userId: user.id,
        periodOption,
        customStartDate,
        customEndDate,
        medsSelection,
        selectedMeds
      });
      setReportSuccess(true);
    } catch (err: any) {
      console.error('[Privacy] Error generating report:', err);
      setError(err.message || 'Falha ao gerar o relatório em PDF. Tente novamente.');
    } finally {
      setReportGenerating(false);
    }
  };

  const handleDownloadData = async () => {
    if (!user) {
      setError('Você precisa estar autenticado para baixar seus dados.');
      return;
    }

    setLoading(true);
    setSuccess(false);
    setError(null);

    try {
      await reportService.generateUserDataReport({ user, profile });
      setSuccess(true);
    } catch (err: any) {
      console.error('[Privacy] PDF generation failed:', err);
      setError('Falha ao gerar o arquivo PDF: ' + (err.message || 'Erro de renderização do PDF.'));
    } finally {
      setLoading(false);
    }
  };

  if (showPolicy) {
    return (
      <motion.div
        id="privacy-policy-view"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 15 }}
        transition={{ duration: 0.3 }}
        className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-0"
      >
        {/* Header with Back button */}
        <div className="flex items-center gap-4">
          <button
            id="btn-back-to-privacy-menu"
            onClick={() => setShowPolicy(false)}
            className="p-2.5 bg-white hover:bg-slate-50 border border-slate-100 rounded-2xl text-slate-500 hover:text-slate-800 transition-colors shadow-sm cursor-pointer flex items-center justify-center"
            title="Voltar para Privacidade"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Política de Privacidade</h2>
            <p className="text-xs md:text-sm text-slate-500">Transparência sobre seus dados pessoais</p>
          </div>
        </div>

        {/* Policy Document Card */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 md:p-8 space-y-6 text-slate-600 leading-relaxed text-sm">
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">1. Introdução</h3>
            <p>
              No aplicativo <strong>Remédio em Dia</strong>, priorizamos a segurança e a confidencialidade das suas informações médicas e pessoais. Esta Política de Privacidade explica de forma simples quais dados coletamos, como eles são utilizados e como garantimos os seus direitos conforme a legislação de proteção de dados (como a LGPD).
            </p>
          </div>

          <hr className="border-slate-100" />

          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">2. Quais Dados Coletamos?</h3>
            <p className="mb-2">
              Para possibilitar o funcionamento das funcionalidades do aplicativo, armazenamos as seguintes informações fornecidas por você:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Dados de Perfil:</strong> Seu nome (ou do paciente sob seus cuidados) e endereço de e-mail.</li>
              <li><strong>Medicamentos:</strong> Nomes dos medicamentos, dosagens, horários de ingestão, notas personalizadas e informações de estoque.</li>
              <li><strong>Lembretes e Compromissos:</strong> Horários configurados para alertas e datas de consultas médicas.</li>
              <li><strong>Preferências do Aplicativo:</strong> Customizações de alertas, notificações e preferências de visualização.</li>
            </ul>
          </div>

          <hr className="border-slate-100" />

          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">3. Como Usamos Seus Dados</h3>
            <p className="mb-2">
              Seus dados são usados estritamente para o funcionamento do serviço personalizado de monitoramento e alertas de medicamentos:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Enviar lembretes no horário correto para que você não esqueça suas doses.</li>
              <li>Notificar sobre medicamentos próximos de vencer ou estoques que estão acabando.</li>
              <li>Facilitar o acompanhamento do seu histórico de saúde de forma simplificada.</li>
            </ul>
            <p className="mt-2 text-slate-500 italic">
              <strong>Importante:</strong> Não compartilhamos, vendemos ou alugamos seus dados pessoais com parceiros de marketing, redes de anúncios ou quaisquer terceiros.
            </p>
          </div>

          <hr className="border-slate-100" />

          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">4. Seus Direitos (LGPD)</h3>
            <p className="mb-2">
              Como titular de dados, a LGPD garante a você controle total sobre suas informações. No aplicativo Remédio em Dia, você pode exercer os seguintes direitos:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Portabilidade (Baixar Meus Dados):</strong> Obter a qualquer momento um relatório legível em formato PDF com todas as suas informações pessoais.</li>
              <li><strong>Exclusão:</strong> Você pode excluir permanentemente sua conta e todos os dados associados a ela na aba de Segurança.</li>
              <li><strong>Retificação:</strong> Corrigir qualquer informação imprecisa ou desatualizada diretamente pelo painel do aplicativo.</li>
            </ul>
          </div>

          <hr className="border-slate-100" />

          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">5. Segurança dos Dados</h3>
            <p>
              Adotamos práticas de segurança rigorosas, como criptografia, controle de acesso restrito (Row Level Security) e ambientes de armazenamento seguros em nuvem para que seus dados permaneçam sempre privados e acessíveis apenas por você.
            </p>
          </div>

          <hr className="border-slate-100" />

          <div className="pt-2">
            <button
              id="btn-back-to-privacy-menu-bottom"
              onClick={() => setShowPolicy(false)}
              className="w-full font-bold py-3.5 px-6 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
            >
              Voltar para Privacidade
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  if (showReportConfig) {
    return (
      <motion.div
        id="report-config-container"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 15 }}
        transition={{ duration: 0.3 }}
        className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-0"
      >
        {/* Header with Back button */}
        <div className="flex items-center gap-4">
          <button
            id="btn-back-from-report-config"
            onClick={() => {
              setShowReportConfig(false);
              setReportSuccess(false);
              setError(null);
              if (onBackToPrevious) {
                onBackToPrevious();
              } else if (onResetReportConfig) {
                onResetReportConfig();
              }
            }}
            className="p-2.5 bg-white hover:bg-slate-50 border border-slate-100 rounded-2xl text-slate-500 hover:text-slate-800 transition-colors shadow-sm cursor-pointer flex items-center justify-center"
            title="Voltar"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Relatório de Tomadas</h2>
            <p className="text-xs md:text-sm text-slate-500">Configure o período e medicamentos para exportar seu histórico</p>
          </div>
        </div>

        {error && (
          <div id="report-error-banner" className="bg-red-50 border border-red-100 rounded-2xl p-4 text-red-700 text-sm flex gap-3 items-start">
            <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="font-bold">Ocorreu um erro</p>
              <p className="text-red-600">{error}</p>
            </div>
          </div>
        )}

        {reportSuccess && (
          <div id="report-success-banner" className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-emerald-800 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
            <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="font-bold">Relatório de histórico gerado com sucesso!</p>
              <p className="text-emerald-600">O download do PDF contendo o histórico de tomadas foi iniciado.</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-6">
          {/* Section 1: Period Selection */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-800 text-base">1. Selecione o período</h3>
            <div className="flex flex-wrap gap-2">
              {[
                { value: '7', label: '7 Dias' },
                { value: '30', label: '30 Dias' },
                { value: '90', label: '90 Dias' },
                { value: 'all', label: 'Todo o histórico' },
                { value: 'custom', label: 'Personalizado' }
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  id={`btn-period-opt-${opt.value}`}
                  onClick={() => setPeriodOption(opt.value as any)}
                  className={`px-4 py-2 text-sm font-semibold rounded-2xl border transition-all cursor-pointer ${
                    periodOption === opt.value
                      ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {periodOption === 'custom' && (
              <div className="grid grid-cols-2 gap-4 pt-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500">Data Inicial</label>
                  <input
                    type="date"
                    id="input-report-start-date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-slate-800 bg-slate-50 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500">Data Final</label>
                  <input
                    type="date"
                    id="input-report-end-date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-slate-800 bg-slate-50 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>
            )}
          </div>

          <hr className="border-slate-100" />

          {/* Section 2: Medication Selection */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-800 text-base">2. Medicamentos para incluir</h3>
            <div className="flex gap-2">
              {[
                { value: 'all', label: 'Todos os medicamentos' },
                { value: 'specific', label: 'Selecionar específicos' }
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  id={`btn-meds-sel-${opt.value}`}
                  onClick={() => {
                    setMedsSelection(opt.value as any);
                    if (opt.value === 'specific' && selectedMeds.length === 0) {
                      setSelectedMeds(medications.map(m => m.id));
                    }
                  }}
                  className={`px-4 py-2 text-sm font-semibold rounded-2xl border transition-all cursor-pointer ${
                    medsSelection === opt.value
                      ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {medsSelection === 'specific' && (
              <div className="space-y-3 pt-2 max-h-72 overflow-y-auto pr-1 border border-slate-100 rounded-2xl p-4 bg-slate-50 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex justify-between items-center pb-2 border-b border-slate-200/60">
                  <span className="text-xs font-bold text-slate-500">
                    {selectedMeds.length} de {medications.length} selecionados
                  </span>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      id="btn-select-all-meds"
                      onClick={() => setSelectedMeds(medications.map(m => m.id))}
                      className="text-xs font-bold text-blue-600 hover:text-blue-700"
                    >
                      Selecionar Todos
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      id="btn-select-none-meds"
                      onClick={() => setSelectedMeds([])}
                      className="text-xs font-bold text-slate-500 hover:text-slate-700"
                    >
                      Limpar
                    </button>
                  </div>
                </div>

                {medications.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center italic">Nenhum medicamento encontrado.</p>
                ) : (
                  <div className="space-y-2">
                    {medications.map(med => {
                      const isSelected = selectedMeds.includes(med.id);
                      return (
                        <div
                          key={med.id}
                          id={`med-item-select-${med.id}`}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedMeds(selectedMeds.filter(id => id !== med.id));
                            } else {
                              setSelectedMeds([...selectedMeds, med.id]);
                            }
                          }}
                          className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                            isSelected 
                              ? 'bg-white border-blue-100 shadow-sm' 
                              : 'bg-white/60 border-slate-100 hover:bg-white hover:border-slate-200'
                          }`}
                        >
                          <div className="shrink-0 text-blue-600">
                            {isSelected ? (
                              <CheckSquare size={18} className="fill-blue-50" />
                            ) : (
                              <Square size={18} className="text-slate-300" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm text-slate-800 truncate">{med.name}</p>
                            <p className="text-xs text-slate-400 truncate">
                              {med.dosage ? `${med.dosage} ${formatUnit(med.unit, 1)}` : 'Sem dosagem'} 
                              {med.deleted ? (
                                <span className="ml-2 text-slate-500 font-semibold">(Inativo - Histórico)</span>
                              ) : med.active === false ? (
                                <span className="ml-2 text-slate-400 font-semibold">(Inativo)</span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <hr className="border-slate-100" />

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              id="btn-cancel-report"
              type="button"
              disabled={reportGenerating}
              onClick={() => {
                setShowReportConfig(false);
                setError(null);
              }}
              className="flex-1 font-bold py-3.5 px-6 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              id="btn-submit-generate-report"
              type="button"
              disabled={reportGenerating}
              onClick={handleGenerateReport}
              className={`flex-1 font-bold py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
                reportGenerating
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-100 active:scale-[0.98]'
              }`}
            >
              <FileDown size={18} className={reportGenerating ? 'animate-bounce' : ''} />
              {reportGenerating ? 'Gerando Relatório...' : 'Gerar Relatório'}
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      id="privacy-page-container"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
      transition={{ duration: 0.3 }}
      className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-0"
    >
      {/* Header with Back button */}
      <div className="flex items-center gap-4">
        <button
          id="btn-back-to-settings-from-privacy"
          onClick={() => setView('settings')}
          className="p-2.5 bg-white hover:bg-slate-50 border border-slate-100 rounded-2xl text-slate-500 hover:text-slate-800 transition-colors shadow-sm cursor-pointer flex items-center justify-center"
          title="Voltar para Ajustes"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Privacidade</h2>
          <p className="text-xs md:text-sm text-slate-500">Gerencie a privacidade e exportação de seus dados pessoais</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Status Banners */}
        {success && (
          <div id="privacy-success-banner" className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-emerald-800 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
            <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="font-bold">PDF gerado com sucesso!</p>
              <p className="text-emerald-600">Seu relatório de dados pessoais está pronto para download.</p>
            </div>
          </div>
        )}

        {reportSuccess && (
          <div id="report-success-banner" className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-emerald-800 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
            <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="font-bold">Relatório de histórico gerado com sucesso!</p>
              <p className="text-emerald-600">O download do PDF contendo o histórico de tomadas foi iniciado.</p>
            </div>
          </div>
        )}

        {error && (
          <div id="privacy-error-banner" className="bg-red-50 border border-red-100 rounded-2xl p-4 text-red-700 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
            <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="font-bold">Ocorreu um erro no processo</p>
              <p className="text-red-600">{error}</p>
            </div>
          </div>
        )}

        {/* Baixar meus dados section */}
        <div id="privacy-download-card" className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-6">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl shrink-0">
              <FileText size={24} />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-slate-800 text-lg">Baixar meus dados</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                Você pode solicitar uma cópia dos dados armazenados em sua conta.
              </p>
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl text-xs text-slate-500 flex gap-2">
            <Clock size={16} className="text-slate-400 shrink-0 mt-0.5" />
            <p>
              Este relatório apresenta seus dados de forma clara e organizada, contendo apenas informações relevantes da sua conta e utilização do aplicativo.
            </p>
          </div>

          <button
            id="btn-trigger-pdf-download"
            disabled={loading}
            onClick={handleDownloadData}
            className={`w-full font-bold py-4 px-6 rounded-2xl flex items-center justify-center gap-2 transition-all ${
              loading 
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-100 active:scale-[0.98]'
            }`}
          >
            <Download size={18} className={loading ? 'animate-bounce' : ''} />
            {loading ? 'Reunindo dados e gerando PDF...' : 'Baixar PDF'}
          </button>
        </div>


        {/* Card: Política de Privacidade */}
        <div id="privacy-policy-card" className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-6">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl shrink-0">
              <Shield size={24} />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-slate-800 text-lg">Política de Privacidade</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                Entenda como coletamos, protegemos e tratamos as suas informações pessoais.
              </p>
            </div>
          </div>

          <a
            id="btn-access-privacy-policy"
            href="https://remedioemdia.com/privacidade/"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full font-bold py-4 px-6 rounded-2xl flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all active:scale-[0.98] cursor-pointer"
          >
            Acessar a Política de Privacidade
          </a>
        </div>

        {/* Card: Termos de Uso */}
        <div id="terms-of-use-card" className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-6">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl shrink-0">
              <FileText size={24} />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-slate-800 text-lg">Termos de Uso</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                Consulte os termos e condições para utilizar o Remédio em Dia.
              </p>
            </div>
          </div>

          <a
            id="btn-access-terms-of-use"
            href="https://remedioemdia.com/termosdeuso/"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full font-bold py-4 px-6 rounded-2xl flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all active:scale-[0.98] cursor-pointer"
          >
            Acessar os Termos de Uso
          </a>
        </div>
      </div>
    </motion.div>
  );
};

export default Privacy;
