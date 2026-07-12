import React, { useState, useEffect } from 'react';
import { ArrowLeft, Sparkles, Calendar, CreditCard, CheckCircle2, Loader2, ShieldCheck, Zap, ShieldAlert } from 'lucide-react';
import { useAuth } from '../src/hooks/useAuth';
import { stripeClientService } from '../src/services/stripeClientService';
import { ViewType } from '../types';
import { motion } from 'motion/react';

interface Props {
  setView: (view: ViewType) => void;
}

const Subscription: React.FC<Props> = ({ setView }) => {
  const { user, profile, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initAndSync = async () => {
      await refreshProfile();
      if (user?.id) {
        try {
          await stripeClientService.syncSubscription(user.id);
          await refreshProfile();
        } catch (syncErr) {
          console.error('[Subscription] Falha ao sincronizar assinatura com Stripe:', syncErr);
        }
      }
    };

    initAndSync().catch(err => {
      console.error('[Subscription] Erro ao carregar dados na montagem:', err);
    });
  }, []);

  const plan = profile?.plan || 'free';
  const status = profile?.subscription_status || 'expired';
  const subscriptionEndsAt = profile?.subscription_ends_at;

  const handleSubscribe = async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const checkoutUrl = await stripeClientService.createCheckoutSession(profile);
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      } else {
        throw new Error('Não foi possível gerar a URL de pagamento. Certifique-se de que a API Key do Stripe está configurada.');
      }
    } catch (err: any) {
      console.error('[Subscription] Error initiating checkout:', err);
      setError(err?.message || 'Ocorreu um erro ao carregar sua assinatura. Por favor, verifique as configurações ou tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleManage = async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const returnUrl = `${window.location.origin}/settings/subscription`;
      const portalUrl = await stripeClientService.createPortalSession(profile, returnUrl);
      if (portalUrl) {
        window.location.href = portalUrl;
      } else {
        throw new Error('Não foi possível gerar a URL do portal de assinatura.');
      }
    } catch (err: any) {
      console.error('[Subscription] Error initiating portal:', err);
      setError(err?.message || 'Não foi possível produzir o portal de faturamento. Verifique sua conexão e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      // Ensure the formatted date is returned in pt-BR locale
      return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) || date.toLocaleDateString('pt-BR');
    } catch (e) {
      return dateString;
    }
  };

  const premiumFeatures = [
    'Cadastro ilimitado de medicamentos.',
    'Cadastro ilimitado de compromissos.',
    'Ideal para quem faz tratamentos contínuos ou acompanha várias condições de saúde.',
    'Permite centralizar toda a rotina de saúde em um único lugar, sem precisar inativar medicamentos ou compromissos para liberar espaço para novos cadastros.',
    'Mais flexibilidade para quem possui uma rotina médica mais complexa.'
  ];

  const containerVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } }
  };

  return (
    <motion.div 
      id="subscription-page-container"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="space-y-6 pb-20 md:pb-0 max-w-2xl mx-auto"
    >
      {/* Header with Back button */}
      <div className="flex items-center gap-4">
        <button 
          id="btn-back-to-settings"
          onClick={() => setView('settings')}
          className="p-2.5 bg-white hover:bg-slate-50 border border-slate-100 rounded-2xl text-slate-500 hover:text-slate-800 transition-colors shadow-sm"
          title="Voltar para Ajustes"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Minha Assinatura</h2>
          <p className="text-xs md:text-sm text-slate-500">Gerencie seu plano e recursos de faturamento</p>
        </div>
      </div>

      {error && (
        <div id="subscription-error-banner" className="bg-red-50 border border-red-100 rounded-2xl p-4 text-red-700 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
          <ShieldAlert className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div>
            <p className="font-semibold">Não foi possível iniciar o checkout</p>
            <p className="text-xs mt-1 text-red-600/80">{error}</p>
          </div>
        </div>
      )}

      {/* Main Status Display Card */}
      <div id="subscription-status-card" className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-6 mb-6">
            <div className="flex items-center gap-4">
              {plan === 'premium' ? (
                <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500">
                  <Sparkles size={24} className="animate-pulse" />
                </div>
              ) : (
                <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-500">
                  <Zap size={24} />
                </div>
              )}
              <div>
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Plano Atual</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <h3 className="text-xl font-bold text-slate-800 capitalize">
                    {plan === 'premium' ? 'Remédio em Dia Premium' : 'Plano Gratuito / Free'}
                  </h3>
                  {plan === 'premium' && (
                    <span className="px-2.5 py-0.5 bg-gradient-to-r from-amber-500 to-amber-600 text-[10px] font-black uppercase text-white rounded-full shadow-sm tracking-widest leading-normal">
                      PRO
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div>
              {plan === 'premium' && status === 'active' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl text-xs font-bold font-mono">
                  ● ATIVO
                </span>
              )}
              {plan === 'premium' && status === 'canceled' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-xl text-xs font-bold font-mono">
                  ● CANCELAMENTO AGENDADO
                </span>
              )}
              {plan === 'free' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-600 border border-slate-200 rounded-xl text-xs font-bold font-mono">
                  ● ATIVO
                </span>
              )}
            </div>
          </div>

          {/* Conditional Detail Sections */}
          {plan === 'free' ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed font-medium">
                Você está utilizando a versão gratuita do Remédio em Dia. Tenha mais tranquilidade com cadastros de medicações e compromissos sem limites ao assinar o Premium!
              </p>
              
              <div className="mt-6 pt-2">
                <button 
                  id="btn-subscribe-premium"
                  onClick={handleSubscribe}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md active:scale-[0.99] disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Iniciando Assinatura Segura Stripe...
                    </>
                  ) : (
                    <>
                      <Sparkles size={20} />
                      Assinar Premium - R$ 14,90/mês
                    </>
                  )}
                </button>
                <div className="flex flex-col items-center justify-center gap-1.5 mt-3">
                  <span className="text-[11px] text-blue-700 font-bold bg-blue-50 border border-blue-100 px-3 py-1 rounded-full uppercase tracking-wider animate-pulse shadow-sm">
                    🚀 Preço promocional de lançamento!
                  </span>
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400 mt-1 font-medium">
                    <ShieldCheck size={14} className="text-emerald-500" />
                    Processamento de assinatura seguro garantido pelo Stripe
                  </div>
                </div>
              </div>
            </div>
          ) : plan === 'premium' && status === 'active' ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {subscriptionEndsAt && (
                  <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <Calendar size={20} className="text-blue-500 shrink-0" />
                    <div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase block">Próxima Renovação</span>
                      <span className="text-sm font-bold text-slate-700">{formatDate(subscriptionEndsAt)}</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <CreditCard size={20} className="text-indigo-500 shrink-0" />
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase block">Método de Cobrança</span>
                    <span className="text-sm font-bold text-slate-700">Cartão de Crédito / Pix</span>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button 
                  id="btn-manage-subscription-active"
                  onClick={handleManage}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl transition-all shadow-sm active:scale-[0.99] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Abrindo portal...
                    </>
                  ) : (
                    'Gerenciar assinatura'
                  )}
                </button>
              </div>
            </div>
          ) : plan === 'premium' && status === 'canceled' ? (
            <div className="space-y-6">
              <div className="p-4 bg-amber-50/50 border border-amber-100 rounded-2xl">
                <p className="text-amber-800 text-sm leading-relaxed font-semibold">
                  Seu acesso Premium permanece ativo até <span className="underline">{formatDate(subscriptionEndsAt)}</span>. 
                </p>
                <p className="text-xs text-amber-700/80 mt-1 leading-normal font-medium">
                  Após essa data limite, o faturamento automático será encerrado e sua conta retornará automaticamente ao plano gratuito. Mais nenhum valor será cobrado. Seu histórico de medicamentos e consultas já cadastrados ainda poderá ser consultado.
                </p>
              </div>

              <div className="pt-2">
                <button 
                  id="btn-manage-subscription-canceled"
                  onClick={handleManage}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl transition-all shadow-sm active:scale-[0.99] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Abrindo portal...
                    </>
                  ) : (
                    'Gerenciar assinatura'
                  )}
                </button>
              </div>
            </div>
          ) : (
            // Outros status como trial expirado etc.
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Seu período de teste ou de assinatura Premium expirou. Assine agora para retomar todos os recursos Premium!
              </p>
              
              <button 
                id="btn-subscribe-premium-expired"
                onClick={handleSubscribe}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md active:scale-[0.99] disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Iniciando Assinatura Segura Stripe...
                  </>
                ) : (
                  <>
                    <Sparkles size={20} />
                    Assinar Premium - R$ 14,90/mês
                  </>
                )}
              </button>
              <div className="flex flex-col items-center justify-center gap-1.5 mt-2">
                <span className="text-[11px] text-blue-700 font-bold bg-blue-50 border border-blue-100 px-3 py-1 rounded-full uppercase tracking-wider animate-pulse shadow-sm">
                  🚀 Preço promocional de lançamento!
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Premium Features Checklist Card */}
      <div id="premium-features-card" className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden p-6 md:p-8">
        <h4 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-6">
          <Sparkles size={18} className="text-amber-500 shrink-0" />
          Vantagens do Remédio em Dia Premium
        </h4>

        <div className="space-y-4">
          {premiumFeatures.map((feature, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="p-0.5 bg-blue-50 text-blue-600 rounded-lg shrink-0 mt-0.5">
                <CheckCircle2 size={16} />
              </div>
              <p className="text-sm text-slate-600 font-medium">{feature}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
};

export default Subscription;
