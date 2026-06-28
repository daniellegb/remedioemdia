import React from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LimitReachedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgradeClick: () => void;
  onManageClick: () => void;
}

export const LimitReachedModal: React.FC<LimitReachedModalProps> = ({
  isOpen,
  onClose,
  onUpgradeClick,
  onManageClick,
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl overflow-hidden border border-slate-100"
          >
            <div className="p-6 sm:p-8 text-center flex flex-col items-center">
              <button
                onClick={onClose}
                className="absolute right-6 top-6 p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors"
                aria-label="Close"
              >
                <X size={20} />
              </button>

              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-3xl flex items-center justify-center shadow-lg shadow-red-100/50 mb-6 mt-2">
                <ShieldAlert size={36} />
              </div>

              <div className="space-y-3 mb-8">
                <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  Limite do Plano Gratuito atingido
                </h3>
                <p className="text-slate-500 text-sm leading-relaxed max-w-sm">
                  Você já atingiu o limite de itens ativos permitido pelo seu plano. Para reativar este item, desative outro item ativo ou faça upgrade para o Plano Premium.
                </p>
              </div>

              {/* Botões de Ação */}
              <div className="flex flex-col gap-3 w-full">
                <button
                  type="button"
                  onClick={onManageClick}
                  className="w-full px-6 py-4 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-2xl transition-all"
                >
                  Gerenciar itens ativos
                </button>
                <button
                  type="button"
                  onClick={onUpgradeClick}
                  className="w-full px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-100"
                >
                  Tornar-se Premium
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full px-6 py-3 text-slate-400 hover:text-slate-600 font-bold text-sm transition-all"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default LimitReachedModal;
