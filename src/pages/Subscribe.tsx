import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { 
  Pill, 
  Mail, 
  Loader2, 
  AlertTriangle, 
  ShieldCheck, 
  CheckCircle, 
  Sparkles, 
  Crown,
  UserCheck,
  Check,
  ShieldAlert,
  CreditCard
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { stripeClientService } from '../services/stripeClientService';

const Subscribe: React.FC = () => {
  // Estados locais controlados do formulário de assinatura
  const [email, setEmail] = useState('');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  
  // Estados de carregamento, erros e checkout
  const [loading, setLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  const turnstileWidgetRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const navigate = useNavigate();
  const { 
    user, 
    profile, 
    isAuthenticated, 
    loading: authLoading, 
    isConfigured,
    signOut
  } = useAuth();

  // Gerenciar renderização do Turnstile para a tela de cadastro
  useEffect(() => {
    if (isAuthenticated) return; // Não inicializar Turnstile se já estiver logado

    let isMounted = true;
    const container = turnstileWidgetRef.current;

    const timer = setTimeout(() => {
      if (!isMounted || !container) return;
      if ((window as any).turnstile) {
        try {
          if (container.hasChildNodes()) {
            container.innerHTML = '';
          }
          if (widgetIdRef.current !== null) {
            try {
              (window as any).turnstile.remove(widgetIdRef.current);
            } catch (err) {
              // Ignorar erros de widget desinstalado
            }
            widgetIdRef.current = null;
          }
          const siteKey = (import.meta.env as any).VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';
          widgetIdRef.current = (window as any).turnstile.render(container, {
            key: siteKey,
            sitekey: siteKey,
            callback: (token: string) => {
              if (isMounted) {
                setTurnstileToken(token);
                setError(null);
              }
            },
            'expired-callback': () => {
              if (isMounted) {
                setTurnstileToken(null);
              }
            },
            'error-callback': () => {
              if (isMounted) {
                setTurnstileToken(null);
              }
            }
          });
        } catch (e) {
          console.error('Error rendering turnstile on Subscribe page:', e);
        }
      }
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (widgetIdRef.current !== null && (window as any).turnstile) {
        try {
          (window as any).turnstile.remove(widgetIdRef.current);
        } catch (e) {
          // Ignore
        }
        widgetIdRef.current = null;
      }
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [isAuthenticated]);

  const resetTurnstile = () => {
    setTurnstileToken(null);
    if (widgetIdRef.current !== null && (window as any).turnstile) {
      try {
        (window as any).turnstile.reset(widgetIdRef.current);
      } catch (err) {
        console.error('Error resetting Turnstile on Subscribe page:', err);
      }
    }
  };

  // Função para submeter e ir para o checkout
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      setError('Por favor, informe um e-mail válido.');
      return;
    }

    if (!legalAccepted) {
      setError('É necessário aceitar os Termos de Uso e a Política de Privacidade para criar uma conta.');
      return;
    }

    if (!turnstileToken) {
      setError('Não foi possível validar a verificação de segurança. Tente novamente.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // Futura chamada ao endpoint de checkout guest
      setSuccessMessage('Redirecionando para o pagamento...');
    } catch (err: any) {
      console.error('Subscribe page submit error:', err);
      setError(err.message || 'Erro ao processar.');
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  };

  // Função para iniciar o Stripe Checkout de Assinatura Premium
  const handleStartCheckout = async () => {
    if (!profile && !user) return;
    setCheckoutLoading(true);
    setError(null);

    const userProfile = profile || {
      id: user!.id,
      name: user?.user_metadata?.name || user?.email?.split('@')[0] || 'Usuário',
      email: user?.email,
      plan: 'free',
      subscription_status: 'expired'
    };

    try {
      const checkoutUrl = await stripeClientService.createCheckoutSession(userProfile as any);
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      } else {
        throw new Error('Não foi possível gerar a URL de pagamento. Tente novamente.');
      }
    } catch (err: any) {
      console.error('[Subscribe] Erro ao iniciar Stripe Checkout:', err);
      setError(err?.message || 'Ocorreu um erro ao gerar o checkout de pagamento. Tente novamente.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 md:p-6">
      <div className="max-w-md w-full bg-white rounded-[40px] shadow-xl border border-slate-100 p-8 md:p-12 space-y-6">
        {/* Supabase unconfigured alert */}
        {!isConfigured && (
          <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3">
            <AlertTriangle className="text-amber-500 shrink-0" size={20} />
            <div>
              <p className="text-amber-800 text-sm font-bold">Configuração Pendente</p>
              <p className="text-amber-700 text-xs mt-1">
                As variáveis de ambiente do Supabase não foram encontradas.
              </p>
            </div>
          </div>
        )}

        {/* Header Branding */}
        <div className="flex flex-col items-center">
          {!logoError ? (
            <img
              src="/remedio-em-dia-logo-vertical.png"
              alt="Remédio em Dia Logo"
              className="max-h-[160px] w-auto object-contain mb-3 rounded-2xl"
              onError={() => setLogoError(true)}
            />
          ) : (
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 mb-3">
              <Pill size={32} className="text-white" />
            </div>
          )}

          {/* Badge Indicador de Assinatura Premium */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-amber-500/10 via-amber-500/15 to-amber-500/10 border border-amber-200/80 text-amber-800 text-[11px] font-black rounded-full uppercase tracking-wider mb-2 shadow-xs">
            <Crown size={14} className="text-amber-500 fill-amber-400" />
            <span>Assinatura Premium</span>
          </div>

          <h1 className="text-2xl md:text-3xl font-black text-slate-900 mb-1 text-center">
            Tenha seu Remédio em Dia
          </h1>
          <p className="text-slate-500 font-medium text-sm text-center">
            Crie sua conta para continuar para o pagamento.
          </p>
        </div>

        {/* SE O USUÁRIO JÁ ESTIVER AUTENTICADO */}
        {isAuthenticated ? (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* User identification badge */}
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-10 h-10 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center shrink-0">
                  <UserCheck size={20} />
                </div>
                <div className="truncate">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Conta Ativa</span>
                  <span className="text-sm font-bold text-slate-800 truncate block">{user?.email}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => signOut()}
                className="text-xs font-bold text-slate-500 hover:text-red-600 px-2 py-1 transition-colors"
                title="Trocar de conta"
              >
                Sair
              </button>
            </div>

            {/* Card do Plano Premium */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={20} className="text-amber-500" />
                  <span className="text-sm font-black text-slate-800 uppercase tracking-wider">
                    Remédio em Dia Premium
                  </span>
                </div>
                <span className="px-2.5 py-1 bg-amber-500 text-white text-[10px] font-black uppercase rounded-full tracking-wider">
                  PRO
                </span>
              </div>

              <div className="border-t border-blue-100/80 pt-3">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-slate-900">R$ 14,90</span>
                  <span className="text-sm text-slate-500 font-bold">/mês</span>
                </div>
                <p className="text-xs text-blue-700 font-semibold mt-1">
                  🚀 Preço promocional de lançamento!
                </p>
              </div>

              <ul className="space-y-2 pt-1 text-xs text-slate-700 font-medium">
                <li className="flex items-center gap-2">
                  <Check size={14} className="text-emerald-600 shrink-0" />
                  <span>Cadastro ilimitado de medicamentos</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={14} className="text-emerald-600 shrink-0" />
                  <span>Cadastro ilimitado de compromissos médicos</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={14} className="text-emerald-600 shrink-0" />
                  <span>Gestão completa de estoque e avisos</span>
                </li>
              </ul>
            </div>

            {/* Mensagem de erro se o checkout falhar */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-medium flex gap-2 items-start">
                <ShieldAlert className="text-red-500 shrink-0 mt-0.5" size={18} />
                <span>{error}</span>
              </div>
            )}

            {/* Botão Principal de Assinatura Stripe */}
            <button
              type="button"
              onClick={handleStartCheckout}
              disabled={checkoutLoading}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-blue-200 hover:from-blue-700 hover:to-indigo-700 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 flex items-center justify-center gap-2.5 min-h-[60px] cursor-pointer"
            >
              {checkoutLoading ? (
                <>
                  <Loader2 className="animate-spin" size={22} />
                  <span>Iniciando Checkout...</span>
                </>
              ) : (
                <>
                  <CreditCard size={22} />
                  <span>Assinar Premium</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 font-medium text-center">
              <ShieldCheck size={14} className="text-emerald-500 shrink-0" />
              <span>Processamento de assinatura seguro garantido pelo Stripe</span>
            </div>
          </div>
        ) : (
          /* FORMULÁRIO DE CADASTRO PARA NOVOS USUÁRIOS */
          <form onSubmit={handleRegister} className="space-y-5">
            {/* Input E-mail */}
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">E-mail</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm font-medium"
                  placeholder="seu@email.com"
                  required
                  disabled={!isConfigured || loading}
                />
              </div>
              {/* Alerta de E-mail Único / Não Alterável - exibido apenas ao digitar */}
              <AnimatePresence>
                {email.trim().length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3.5 bg-amber-50/90 border border-amber-200/80 rounded-2xl flex items-start gap-2.5 text-xs text-amber-900 leading-relaxed font-medium">
                      <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16} />
                      <span>
                        Este e-mail será utilizado para criar sua conta no aplicativo e <strong>não poderá ser alterado posteriormente</strong>.
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Checkbox de Termos de Uso */}
            <div className="flex items-start gap-3 pt-1">
              <input
                type="checkbox"
                id="legal-terms-subscribe"
                checked={legalAccepted}
                onChange={(e) => setLegalAccepted(e.target.checked)}
                className="mt-1 w-4 h-4 text-blue-600 bg-slate-50 border-slate-300 rounded focus:ring-blue-500 cursor-pointer accent-blue-600 shrink-0"
              />
              <label htmlFor="legal-terms-subscribe" className="text-xs text-slate-600 font-medium leading-relaxed cursor-pointer select-none">
                Li e concordo com os{' '}
                <a
                  href="https://remedioemdia.com/termosdeuso/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 font-bold hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Termos de Uso
                </a>{' '}
                e a{' '}
                <a
                  href="https://remedioemdia.com/privacidade/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 font-bold hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Política de Privacidade
                </a>
                .
              </label>
            </div>

            {/* Widget Cloudflare Turnstile */}
            <div className="flex flex-col items-center justify-center pt-1 pb-1">
              <div ref={turnstileWidgetRef} id="cf-turnstile-subscribe" className="min-h-[65px]"></div>
              {!turnstileToken && (
                <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                  <ShieldCheck size={13} className="text-blue-500" />
                  Aguardando verificação de segurança...
                </p>
              )}
            </div>

            {/* Mensagem de Sucesso */}
            {successMessage && (
              <div className="p-4 bg-green-50 border border-green-100 rounded-2xl text-green-700 text-sm font-medium flex items-start gap-2">
                <CheckCircle size={18} className="text-green-600 shrink-0 mt-0.5" />
                <span>{successMessage}</span>
              </div>
            )}

            {/* Exibir Erro */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-medium">
                {error}
              </div>
            )}

            {/* Botão de Cadastro Principal */}
            <button
              type="submit"
              disabled={loading || !isConfigured}
              className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white py-4 rounded-2xl font-black text-base shadow-lg shadow-blue-200 hover:from-blue-700 hover:to-indigo-700 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 flex items-center justify-center gap-2.5 min-h-[60px] cursor-pointer"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={24} />
              ) : (
                <>
                  <Crown size={20} className="text-amber-300 fill-amber-300 shrink-0" />
                  <span>Ir para o Pagamento</span>
                </>
              )}
            </button>

            <div className="pt-2 text-center">
              <p className="text-xs text-slate-500 font-medium">
                Já possui uma conta?{' '}
                <Link to="/login" className="text-blue-600 font-bold hover:underline">
                  Entrar
                </Link>
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default Subscribe;
