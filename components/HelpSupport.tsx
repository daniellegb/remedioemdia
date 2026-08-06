import React from 'react';
import { ArrowLeft, Mail, ExternalLink, HelpCircle } from 'lucide-react';
import { ViewType } from '../types';
import { motion } from 'motion/react';

interface Props {
  setView: (view: ViewType) => void;
}

export const HelpSupport: React.FC<Props> = ({ setView }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
      transition={{ duration: 0.3 }}
      className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-0"
    >
      {/* Header com botão de voltar */}
      <div className="flex items-center gap-4">
        <button
          id="btn-back-to-settings-from-help"
          onClick={() => setView('settings')}
          className="p-2.5 bg-white hover:bg-slate-50 border border-slate-100 rounded-2xl text-slate-500 hover:text-slate-800 transition-colors shadow-sm cursor-pointer flex items-center justify-center"
          title="Voltar para Ajustes"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Ajuda e suporte</h2>
          <p className="text-xs md:text-sm text-slate-500">Central de atendimento e suporte ao usuário</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Card de Contato por E-mail */}
        <div id="help-support-contact-card" className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden p-6 md:p-8 space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl">
              <Mail size={22} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">Contato</h3>
              <p className="text-xs text-slate-400">Atendimento direto por e-mail</p>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed font-medium">
              Se precisar de ajuda, tiver dúvidas, sugestões ou encontrar algum problema no Remédio em Dia, entre em contato conosco pelo e-mail abaixo.
            </p>

            <div className="bg-slate-50 rounded-2xl p-4 md:p-5 border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-white text-blue-600 rounded-xl border border-slate-200/60 shadow-xs shrink-0">
                  <Mail size={20} />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">E-mail</span>
                  <a
                    id="link-support-email"
                    href="mailto:suporte@remedioemdia.com?subject=Suporte%20-%20Rem%C3%A9dio%20em%20Dia"
                    className="text-sm md:text-base font-bold text-blue-600 hover:text-blue-700 hover:underline transition-colors break-all"
                  >
                    suporte@remedioemdia.com
                  </a>
                </div>
              </div>

              <a
                id="btn-open-email"
                href="mailto:suporte@remedioemdia.com?subject=Suporte%20-%20Rem%C3%A9dio%20em%20Dia"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all active:scale-[0.98] cursor-pointer shrink-0"
              >
                <ExternalLink size={14} />
                Enviar e-mail
              </a>
            </div>
          </div>
        </div>

        {/* Estrutura reservada para expansões futuras (Tutoriais, FAQ, Relatar Problema, Sugestões) */}
      </div>
    </motion.div>
  );
};

export default HelpSupport;
