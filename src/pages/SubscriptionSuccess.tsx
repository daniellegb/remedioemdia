import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, CheckCircle2, ArrowRight, Sparkles, Mail } from 'lucide-react';
import { motion } from 'motion/react';

const SubscriptionSuccess: React.FC = () => {
  const [logoError, setLogoError] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-100 p-8 text-center flex flex-col items-center"
      >
        {/* Logo da marca */}
        <div className="mb-6 flex flex-col items-center">
          {!logoError ? (
            <img
              src="/remedio-em-dia-logo-vertical.png"
              alt="Remédio em Dia Logo"
              className="max-h-[180px] w-auto object-contain rounded-2xl"
              onError={() => setLogoError(true)}
            />
          ) : (
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 mb-3">
                <Pill size={32} className="text-white" />
              </div>
              <h1 className="text-2xl font-black text-slate-900">Remédio em Dia</h1>
            </div>
          )}
        </div>

        {/* Tag de confirmação da assinatura */}
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200 text-xs font-bold mb-6 shadow-xs">
          <Sparkles size={14} className="text-amber-600 shrink-0" />
          <span>Assinatura Confirmada</span>
          <CheckCircle2 size={16} className="text-amber-600 shrink-0" />
        </div>

        {/* Mensagem principal */}
        <div className="space-y-4 mb-8 text-center">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            Seja bem-vindo ao Remédio em Dia!
          </h2>
          <p className="text-slate-800 text-base leading-relaxed font-bold">
            Se você é novo por aqui, acesse seu e-mail para definir sua senha de acesso. Atenção: esse passo é necessário para ativar sua conta!
          </p>
          <div className="p-3.5 bg-amber-50/80 border border-amber-200/70 rounded-2xl text-amber-900 text-xs sm:text-sm font-medium italic flex items-start gap-2.5 text-left">
            <Mail size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <span>Não encontrou o e-mail na caixa de entrada? Verifique também a caixa de spam ou lixo eletrônico.</span>
          </div>
          <p className="text-slate-800 text-base font-bold pt-1">
            Se você já é usuário, é só entrar e aproveitar!
          </p>
        </div>

        {/* Botão de acionamento para Login */}
        <Link
          to="/login"
          className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold rounded-2xl shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-2 group"
        >
          <span>Ir para a Tela de Login</span>
          <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </Link>
      </motion.div>
    </div>
  );
};

export default SubscriptionSuccess;
