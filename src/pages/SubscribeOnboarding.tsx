import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { stripeClientService } from '../services/stripeClientService';
import { Pill, Mail, Lock, Loader2, Sparkles, ShieldCheck, CheckCircle, ArrowLeft, Eye, EyeOff, ShieldAlert, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const SubscribeOnboarding: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(true);
  const [isExistingUserMode, setIsExistingUserMode] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preparingCheckout, setPreparingCheckout] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  const turnstileWidgetRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const navigate = useNavigate();
  const { user, profile, isAuthenticated, loading: authLoading, signIn, signUp, isConfigured } = useAuth();

  // Se o usuário já estiver autenticado ao carregar a página, dispara o checkout diretamente
  useEffect(() => {
    if (!authLoading && isAuthenticated && user?.id) {
      initiateCheckoutForAuthenticatedUser();
    }
  }, [isAuthenticated, authLoading, user?.id]);

  // Gerenciar renderização do Turnstile sem redundâncias
  useEffect(() => {
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
              // Ignore
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
          console.error('Error rendering turnstile:', e);
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
  }, [isExistingUserMode]);

  const resetTurnstile = () => {
    setTurnstileToken(null);
    if (widgetIdRef.current !== null && (window as any).turnstile) {
      try {
        (window as any).turnstile.reset(widgetIdRef.current);
      } catch (err) {
        console.error('Error resetting Turnstile:', err);
      }
    }
  };

  const initiateCheckoutForAuthenticatedUser = async () => {
    setPreparingCheckout(true);
    setError(null);
    try {
      const userProfile = profile || { id: user?.id || '' };
      const checkoutUrl = await stripeClientService.createCheckoutSession(userProfile);
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      } else {
        throw new Error('Não foi possível gerar o link de pagamento. Tente novamente.');
      }
    } catch (err: any) {
      console.error('[SubscribeOnboarding] Checkout error:', err);
      setError(err?.message || 'Erro ao preparar a sessão de pagamento. Por favor, tente novamente.');
      setPreparingCheckout(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !email.includes('@')) {
      setError('Por favor, informe um e-mail válido.');
      return;
    }

    if (!password || password.length < 6) {
      setError('A senha deve conter pelo menos 6 caracteres.');
      return;
    }

    if (!isExistingUserMode && !legalAccepted) {
      setError('É necessário aceitar os Termos de Uso e a Política de Privacidade para continuar.');
      return;
    }

    setLoading(true);

    try {
      if (isExistingUserMode) {
        // Fluxo para quem já possui conta
        await signIn(email, password, turnstileToken || undefined);
        setLoading(false);
        // O useEffect detectará `isAuthenticated` e disparará `initiateCheckoutForAuthenticatedUser`
      } else {
        // Fluxo para novo usuário
        const acceptanceTimestamp = new Date().toISOString();
        const signUpResult = await signUp(email, password, acceptanceTimestamp, turnstileToken || undefined);
        
        // Verificar se houve resposta de cadastro
        if (signUpResult?.user) {
          setLoading(false);
          // Se o login for automático após cadastro (padrão Supabase):
          // O useEffect detectará a sessão e iniciará o checkout.
          // Como garantia rápida, chamamos diretamente se o user estiver no resultado:
          setPreparingCheckout(true);
          try {
            const checkoutUrl = await stripeClientService.createCheckoutSession({ id: signUpResult.user.id, email: signUpResult.user.email });
            if (checkoutUrl) {
              window.location.href = checkoutUrl;
            } else {
              throw new Error('Erro ao gerar o link de pagamento.');
            }
          } catch (checkoutErr: any) {
            console.error('[SubscribeOnboarding] Error creating checkout after signup:', checkoutErr);
            setError(checkoutErr?.message || 'Sua conta foi criada com sucesso, mas ocorreu um erro ao iniciar o pagamento. Tente novamente.');
            setPreparingCheckout(false);
          }
        } else {
          // Se o Supabase exigir confirmação por e-mail antes do primeiro login
          setLoading(false);
          setError('Cadastro realizado! Verifique seu e-mail para confirmar a conta e prosseguir para a assinatura.');
        }
      }
    } catch (err: any) {
      console.error('[SubscribeOnboarding] Submit error:', err);
      setLoading(false);
      resetTurnstile();

      const errMsg = err?.message || '';
      if (errMsg.toLowerCase().includes('already registered') || errMsg.toLowerCase().includes('user_already_exists') || errMsg.toLowerCase().includes('ja cadastrado')) {
        setError('Este e-mail já está cadastrado no Remédio em Dia. Clique em "Já tenho uma conta" para entrar e continuar.');
      } else if (errMsg.toLowerCase().includes('invalid login credentials') || errMsg.toLowerCase().includes('invalid_credentials')) {
        setError('E-mail ou senha incorretos. Verifique suas credenciais e tente novamente.');
      } else {
        setError(errMsg || 'Ocorreu um erro ao processar sua solicitação. Tente novamente.');
      }
    }
  };

  if (preparingCheckout) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-[40px] shadow-xl border border-slate-100 p-8 md:p-12 text-center space-y-6">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto animate-bounce shadow-sm">
            <Sparkles size={32} />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Preparando seu pagamento...</h2>
            <p className="text-sm text-slate-500 font-medium">
              Você será redirecionado para o Stripe Checkout em instantes.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-blue-600 font-bold text-sm">
            <Loader2 size={20} className="animate-spin" />
            Conectando ao ambiente seguro do Stripe...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-[40px] shadow-xl border border-slate-100 p-8 md:p-12">
        
        {/* Logo e Cabeçalho da Marca */}
        <div className="flex flex-col items-center mb-6">
          {!logoError ? (
            <img
              src="/remedio-em-dia-logo-vertical.png"
              alt="Remédio em Dia"
              className="max-h-[160px] w-auto object-contain mb-4 rounded-2xl"
              onError={() => setLogoError(true)}
            />
          ) : (
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 mb-4">
              <Pill size={28} className="text-white" />
            </div>
          )}

          {/* Badge do Plano Premium */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-100 text-amber-700 rounded-full text-xs font-bold mb-4 shadow-sm">
            <Sparkles size={14} className="text-amber-500" />
            <span>Assinatura Premium — R$ 14,90/mês</span>
          </div>

          <h1 className="text-2xl md:text-3xl font-black text-slate-900 text-center tracking-tight leading-snug">
            Tenha seu Remédio em Dia
          </h1>

          <p className="text-sm text-slate-500 text-center font-medium mt-2">
            {isExistingUserMode ? 'Entre na sua conta para continuar para o pagamento.' : 'Crie sua conta para continuar para o pagamento.'}
          </p>
        </div>

        {/* Formulário Enxuto (E-mail + Senha) */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">E-mail</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="email"
                id="subscribe-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-slate-800"
                placeholder="seu@email.com"
                required
                disabled={loading || !isConfigured}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">Senha</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type={showPassword ? 'text' : 'password'}
                id="subscribe-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 pl-12 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-slate-800"
                placeholder="••••••••"
                required
                disabled={loading || !isConfigured}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none transition-colors p-1"
                tabIndex={-1}
                title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {/* Checkbox de Termos (Apenas no modo cadastro) */}
          {!isExistingUserMode && (
            <div className="flex items-start gap-3 pt-1">
              <input
                type="checkbox"
                id="subscribe-terms"
                checked={legalAccepted}
                onChange={(e) => setLegalAccepted(e.target.checked)}
                className="mt-1 w-4 h-4 text-blue-600 bg-slate-50 border-slate-300 rounded focus:ring-blue-500 cursor-pointer accent-blue-600 shrink-0"
              />
              <label htmlFor="subscribe-terms" className="text-xs text-slate-600 font-medium leading-relaxed cursor-pointer select-none">
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
          )}

          {/* Widget Cloudflare Turnstile opcional */}
          <div className="flex flex-col items-center justify-center pt-1 pb-1">
            <div ref={turnstileWidgetRef} id="cf-turnstile-subscribe" className="min-h-[65px]"></div>
          </div>

          {/* Mensagem de erro */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-700 text-xs md:text-sm font-medium flex items-start gap-2.5 animate-in fade-in slide-in-from-top-1">
              <ShieldAlert className="text-red-500 shrink-0 mt-0.5" size={18} />
              <span>{error}</span>
            </div>
          )}

          {/* Botão de Ação Principal */}
          <button
            type="submit"
            disabled={loading || !isConfigured}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-4 rounded-2xl font-black text-base md:text-lg shadow-lg shadow-blue-200 hover:from-blue-700 hover:to-indigo-700 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 flex items-center justify-center gap-2 min-h-[58px] cursor-pointer"
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="animate-spin" size={22} />
                <span>{isExistingUserMode ? 'Entrando na conta...' : 'Criando conta...'}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span>Continuar para pagamento</span>
                <ArrowRight size={20} />
              </div>
            )}
          </button>
        </form>

        {/* Alternar entre Criar Conta e Já tenho uma conta */}
        <div className="mt-6 text-center border-t border-slate-100 pt-6">
          <button
            type="button"
            onClick={() => {
              setIsExistingUserMode(!isExistingUserMode);
              setError(null);
            }}
            className="text-sm font-bold text-slate-600 hover:text-blue-600 transition-colors"
          >
            {isExistingUserMode ? (
              <span>Não tem conta? <strong className="text-blue-600 underline">Criar uma nova conta</strong></span>
            ) : (
              <span>Já tenho uma conta. <strong className="text-blue-600 underline">Fazer login</strong></span>
            )}
          </button>
        </div>

        {/* Selo de Garantia e Segurança do Stripe */}
        <div className="mt-6 pt-4 border-t border-slate-50 flex items-center justify-center gap-1.5 text-xs text-slate-400 font-medium">
          <ShieldCheck size={16} className="text-emerald-500 shrink-0" />
          <span>Pagamento seguro via Stripe. Cancele quando quiser.</span>
        </div>

      </div>
    </div>
  );
};

export default SubscribeOnboarding;
