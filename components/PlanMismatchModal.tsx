import React, { useState } from 'react';
import { Medication, Appointment } from '../types';
import { AlertCircle, CheckCircle2, Pill, Calendar, ArrowRight, ShieldAlert, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  isOpen: boolean;
  meds: Medication[];
  appointments: Appointment[];
  onConfirm: (selectedMeds: Medication[], selectedAppointments: Appointment[]) => Promise<void>;
}

export const PlanMismatchModal: React.FC<Props> = ({ isOpen, meds, appointments, onConfirm }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Local active states mapping
  const [localMeds, setLocalMeds] = useState<Medication[]>(() => 
    meds.map(m => ({ ...m, active: m.active ?? true }))
  );
  
  const [localApps, setLocalApps] = useState<Appointment[]>(() => 
    appointments.map(a => ({ ...a, active: a.active ?? true }))
  );

  if (!isOpen) return null;

  const activeMedsCount = localMeds.filter(m => m.active !== false).length;
  const activeAppsCount = localApps.filter(a => a.active !== false).length;

  const medsExceeded = activeMedsCount > 3;
  const appsExceeded = activeAppsCount > 5;
  const hasErrors = medsExceeded || appsExceeded;

  const toggleMed = (id: string) => {
    setLocalMeds(prev => prev.map(m => {
      if (m.id !== id) return m;
      return { ...m, active: !m.active };
    }));
  };

  const toggleApp = (id: string) => {
    setLocalApps(prev => prev.map(a => {
      if (a.id !== id) return a;
      return { ...a, active: !a.active };
    }));
  };

  const handleSave = async () => {
    if (hasErrors) return;
    setIsSubmitting(true);
    try {
      await onConfirm(localMeds, localApps);
    } catch (err) {
      console.error('Error saving plan adaptation selections:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full max-w-2xl rounded-[36px] shadow-2xl border border-slate-100 overflow-hidden my-8"
      >
        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div 
              key="step-1"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="p-8 md:p-10 space-y-6 text-center flex flex-col items-center"
            >
              <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-3xl flex items-center justify-center shadow-lg shadow-amber-100/50">
                <ShieldAlert size={36} />
              </div>
              
              <div className="space-y-3">
                <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Adequação ao Plano Gratuito</h2>
                <p className="text-slate-600 text-sm md:text-base leading-relaxed max-w-md mx-auto">
                  Sua assinatura mudou para o <strong>Plano Gratuito</strong>. Para continuar utilizando a plataforma, precisamos adaptar seus itens ativos aos limites permitidos:
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 w-full max-w-md pt-2">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center space-y-1">
                  <div className="text-2xl font-black text-slate-800">{meds.length}</div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Medicamentos</div>
                  <div className="text-[10px] font-bold text-slate-400">Limite: 3 Ativos</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center space-y-1">
                  <div className="text-2xl font-black text-slate-800">{appointments.length}</div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Compromissos</div>
                  <div className="text-[10px] font-bold text-slate-400">Limite: 5 Ativos</div>
                </div>
              </div>

              <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 text-left flex items-start gap-3 w-full max-w-md">
                <AlertCircle size={18} className="text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-800 leading-relaxed">
                  <strong>Não se preocupe:</strong> nenhum de seus dados será excluído. Medicamentos e compromissos que você inativar continuarão salvos com todo o seu histórico para consulta posterior.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full max-w-md bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-lg hover:shadow-blue-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-4 cursor-pointer"
              >
                <span>Selecionar itens ativos</span>
                <ArrowRight size={18} />
              </button>
            </motion.div>
          ) : (
            <motion.div 
              key="step-2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col h-[80vh] max-h-[640px]"
            >
              {/* Header */}
              <div className="p-6 md:p-8 border-b border-slate-100 shrink-0 bg-white">
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 size={22} className="text-blue-600" />
                  Selecione seus itens ativos
                </h2>
                <p className="text-xs text-slate-400 font-medium mt-1">
                  Desative os itens excedentes para liberar o uso da sua conta.
                </p>
              </div>

              {/* Scrollable Lists Area */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 bg-slate-50/50">
                {/* 1. MEDICAMENTOS SECTION */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Pill size={16} /> Medicamentos
                    </h3>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                      medsExceeded 
                        ? 'bg-red-50 text-red-600 border-red-200' 
                        : 'bg-blue-50 text-blue-600 border-blue-100'
                    }`}>
                      {activeMedsCount} de 3 ativos
                    </span>
                  </div>

                  {medsExceeded && (
                    <p className="text-xs font-semibold text-red-500 flex items-center gap-1">
                      <AlertCircle size={14} /> Selecione no máximo 3 medicamentos ativos.
                    </p>
                  )}

                  <div className="grid grid-cols-1 gap-3">
                    {localMeds.map(med => (
                      <div 
                        key={med.id} 
                        onClick={() => toggleMed(med.id)}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                          med.active
                            ? 'bg-white border-blue-500 shadow-sm'
                            : 'bg-slate-50/70 border-slate-200 opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-xl ${med.color || 'bg-blue-600'} text-white flex items-center justify-center shrink-0`}>
                            <Pill size={20} />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-bold text-slate-800 truncate">{med.name}</h4>
                            <p className="text-[11px] font-medium text-slate-400 truncate">{med.dosage}</p>
                          </div>
                        </div>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          med.active ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300 bg-white'
                        }`}>
                          {med.active && <Check size={14} className="stroke-[3]" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. COMPROMISSOS SECTION */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Calendar size={16} /> Compromissos
                    </h3>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                      appsExceeded 
                        ? 'bg-red-50 text-red-600 border-red-200' 
                        : 'bg-purple-50 text-purple-600 border-purple-100'
                    }`}>
                      {activeAppsCount} de 5 ativos
                    </span>
                  </div>

                  {appsExceeded && (
                    <p className="text-xs font-semibold text-red-500 flex items-center gap-1">
                      <AlertCircle size={14} /> Selecione no máximo 5 compromissos ativos.
                    </p>
                  )}

                  <div className="grid grid-cols-1 gap-3">
                    {localApps.map(app => (
                      <div 
                        key={app.id} 
                        onClick={() => toggleApp(app.id)}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                          app.active
                            ? 'bg-white border-purple-500 shadow-sm'
                            : 'bg-slate-50/70 border-slate-200 opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0`}>
                            <Calendar size={20} />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-bold text-slate-800 truncate">{app.doctor}</h4>
                            <p className="text-[11px] font-medium text-slate-400 truncate">{app.specialty} • {app.date.split('-').reverse().join('/')}</p>
                          </div>
                        </div>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          app.active ? 'border-purple-500 bg-purple-500 text-white' : 'border-slate-300 bg-white'
                        }`}>
                          {app.active && <Check size={14} className="stroke-[3]" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="p-6 md:p-8 border-t border-slate-100 shrink-0 bg-white flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="sm:w-1/3 border-2 border-slate-100 hover:border-slate-200 text-slate-600 py-4 rounded-2xl font-bold text-sm transition-all text-center cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={hasErrors || isSubmitting}
                  className={`flex-1 py-4 rounded-2xl font-extrabold text-sm shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer ${
                    hasErrors || isSubmitting
                      ? 'bg-slate-200 text-slate-400 shadow-none cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-blue-150'
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>Confirmar Seleção</span>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
