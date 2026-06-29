import React, { useState } from 'react';
import { AlertTriangle, X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  type: 'medication' | 'appointment';
  name?: string;
  onConfirm: (keepHistory: boolean) => void;
  onCancel: () => void;
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  isOpen,
  type,
  name,
  onConfirm,
  onCancel,
}) => {
  const [keepHistory, setKeepHistory] = useState(true);

  const isMed = type === 'medication';
  const subtitle = isMed
    ? 'O medicamento será removido da sua lista e seus lembretes serão cancelados.'
    : 'O compromisso será removido da sua lista.';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl overflow-hidden border border-slate-100"
          >
            <div className="p-6 sm:p-8">
              <div className="flex justify-between items-start mb-6">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-red-50 text-red-600">
                  <AlertTriangle size={24} />
                </div>
                <button
                  onClick={onCancel}
                  className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-2 mb-6">
                <h3 className="text-xl font-bold text-slate-900 leading-snug">
                  {isMed
                    ? `Deseja excluir ou inativar o medicamento ${name ? `"${name}"` : 'este medicamento'}?`
                    : `Deseja excluir ou inativar o compromisso ${name ? `"${name}"` : 'este compromisso'}?`}
                </h3>
                <p className="text-slate-500 text-sm leading-relaxed">
                  {subtitle}
                </p>
              </div>

              {/* Opções de exclusão */}
              <div className="space-y-4 mb-8">
                {/* Opção 1: Manter Histórico */}
                <div
                  onClick={() => setKeepHistory(true)}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex gap-3 ${
                    keepHistory
                      ? 'border-blue-600 bg-blue-50/20'
                      : 'border-slate-100 hover:border-slate-200'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-md border flex items-center justify-center mt-0.5 shrink-0 ${
                    keepHistory ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
                  }`}>
                    {keepHistory && <Check size={14} strokeWidth={3} />}
                  </div>
                  <div className="space-y-1">
                    <p className={`text-sm font-bold ${keepHistory ? 'text-blue-900' : 'text-slate-800'}`}>
                      Manter o histórico dest{isMed ? 'e medicamento' : 'e compromisso'} (recomendado)
                    </p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      O histórico continuará disponível para consultas, estatísticas e exportação de dados.
                    </p>
                  </div>
                </div>

                {/* Opção 2: Apagar Tudo */}
                <div
                  onClick={() => setKeepHistory(false)}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex gap-3 ${
                    !keepHistory
                      ? 'border-red-500 bg-red-50/10'
                      : 'border-slate-100 hover:border-slate-200'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-md border flex items-center justify-center mt-0.5 shrink-0 ${
                    !keepHistory ? 'border-red-500 bg-red-500 text-white' : 'border-slate-300 bg-white'
                  }`}>
                    {!keepHistory && <Check size={14} strokeWidth={3} />}
                  </div>
                  <div className="space-y-1">
                    <p className={`text-sm font-bold ${!keepHistory ? 'text-red-900' : 'text-slate-800'}`}>
                      Apagar também todo o histórico dest{isMed ? 'e medicamento' : 'e compromisso'}.
                    </p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Esta ação é permanente e não poderá ser desfeita.
                    </p>
                  </div>
                </div>
              </div>

              {/* Botões de Ação */}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex-1 px-6 py-3.5 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold rounded-2xl transition-all border border-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => onConfirm(keepHistory)}
                  className={`flex-1 px-6 py-3.5 text-white font-bold rounded-2xl transition-all shadow-lg ${
                    keepHistory
                      ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-100'
                      : 'bg-red-600 hover:bg-red-700 shadow-red-100'
                  }`}
                >
                  {keepHistory
                    ? (isMed ? 'Inativar medicamento' : 'Inativar compromisso')
                    : (isMed ? 'Excluir medicamento' : 'Excluir compromisso')}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default DeleteConfirmationModal;
