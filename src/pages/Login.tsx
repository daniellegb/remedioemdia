import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Pill, Mail, Lock, Loader2, AlertTriangle, Activity, Wifi, WifiOff, Bug, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { testSupabaseConnection } from '../lib/supabase';

const Login: React.FC = () => {
  // Estados locais controlados
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [connStatus, setConnStatus] = useState<{ loading: boolean; ok?: boolean; message?: string }>({ loading: false });
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const turnstileWidgetRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading, signIn, signUp, signInWithGoogle, isConfigured } = useAuth();

  // Redirecionar se já estiver autenticado
  React.useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Gerenciar renderização do Turnstile
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((window as any).turnstile && turnstileWidgetRef.current) {
        try {
          if (widgetIdRef.current !== null) {
            (window as any).turnstile.remove(widgetIdRef.current);
          }
          const siteKey = (import.meta.env as any).VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';
          widgetIdRef.current = (window as any).turnstile.render(turnstileWidgetRef.current, {
            key: siteKey,
            sitekey: siteKey,
            callback: (token: string) => {
              setTurnstileToken(token);
              setError(null);
            },
            'expired-callback': () => {
              setTurnstileToken(null);
            },
            'error-callback': () => {
              setTurnstileToken(null);
            }
          });
        } catch (e) {
          console.error('Error rendering turnstile:', e);
        }
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [isSignUp]);

  // Implementar função handleLogin
  const handleLogin = async (e: React.FormEvent) => {
    // Prevenir default
    e.preventDefault();
    
    if (isSignUp) {
      handleRegister();
      return;
    }

    if (!turnstileToken) {
      setError('Não foi possível validar a verificação de segurança. Tente novamente.');
      return;
    }

    // SetLoading(true)
    setLoading(true);
    // Limpar erro
    setError(null);

    try {
      // Chamar signIn(email, password, turnstileToken)
      await signIn(email, password, turnstileToken);
      navigate('/dashboard');
    } catch (err: any) {
      // Tratar erro se houver
      console.error('Login error:', err);
      setError(err.message || 'Erro ao entrar. Verifique suas credenciais.');
    } finally {
      // Finalizar loading
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!isConfigured) return;
    
    if (!turnstileToken) {
      setError('Não foi possível validar a verificação de segurança. Tente novamente.');
      return;
    }

    if (isSignUp && !legalAccepted) {
      setError('É necessário aceitar os Termos de Uso e a Política de Privacidade para criar uma conta.');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      if (isSignUp && legalAccepted) {
        localStorage.setItem('pending_legal_acceptance', new Date().toISOString());
      }
      await signInWithGoogle();
      // Nota: O signInWithOAuth em ambiente web causa um redirect,
      // então o código abaixo pode não ser executado se o redirect for bem-sucedido.
    } catch (err: any) {
      console.error('Google login error (catch):', err);
      setError(err.message || 'Erro ao entrar com Google. Tente novamente.');
      setLoading(false);
    }
  };

  // Implementar função handleRegister
  const handleRegister = async () => {
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

    try {
      const acceptanceTimestamp = new Date().toISOString();
      await signUp(email, password, acceptanceTimestamp, turnstileToken);
      setError('Cadastro realizado com sucesso! Verifique seu e-mail para confirmar a conta.');
      setIsSignUp(false);
    } catch (err: any) {
      console.error('Register error:', err);
      setError(err.message || 'Erro ao realizar cadastro.');
    } finally {
      setLoading(false);
    }
  };

  const checkConnection = async () => {
    setConnStatus({ loading: true });
    const result = await testSupabaseConnection();
    setConnStatus({ loading: false, ok: result.ok, message: result.message });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-[40px] shadow-xl border border-slate-100 p-8 md:p-12">
        {/* Aviso de configuração do Supabase (Mantido conforme layout anterior) */}
        {!isConfigured && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3">
            <AlertTriangle className="text-amber-500 shrink-0" size={20} />
            <div>
              <p className="text-amber-800 text-sm font-bold">Configuração Pendente</p>
              <p className="text-amber-700 text-xs mt-1">
                As variáveis de ambiente do Supabase não foram encontradas. 
                Configure <b>VITE_SUPABASE_URL</b> e <b>VITE_SUPABASE_ANON_KEY</b> no painel do AI Studio.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col items-center mb-6">
          {!logoError ? (
            <img
              src="/remedio-em-dia-logo-vertical.png"
              alt="Remédio em Dia Logo"
              className="max-h-[240px] w-auto object-contain mb-6 rounded-2xl"
              onError={() => setLogoError(true)}
            />
          ) : (
            <>
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 mb-6">
                <Pill size={32} className="text-white" />
              </div>
              <h1 className="text-3xl font-black text-slate-900 mb-2">Remédio em Dia</h1>
            </>
          )}
          <div className="h-6 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.p
                key={isSignUp ? 'signup-subtitle' : 'signin-subtitle'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15 }}
                className="text-slate-500 font-medium"
              >
                {isSignUp ? 'Crie sua conta gratuita' : 'Bem-vindo de volta'}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        {/* Abas Deslizantes para Login / Cadastro */}
        <div className="flex bg-slate-100 p-1.5 rounded-2xl mb-8 relative">
          <button
            type="button"
            onClick={() => {
              setIsSignUp(false);
              setError(null);
            }}
            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-colors relative z-10 ${
              !isSignUp ? 'text-blue-600 font-black' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Entrar
            {!isSignUp && (
              <motion.div
                layoutId="activeTabIndicator"
                className="absolute inset-0 bg-white rounded-xl shadow-sm border border-slate-100/50 -z-10"
                transition={{ type: "spring", stiffness: 350, damping: 28 }}
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsSignUp(true);
              setError(null);
            }}
            className={`flex-1 py-3 text-sm font-bold rounded-xl transition-colors relative z-10 ${
              isSignUp ? 'text-blue-600 font-black' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Cadastrar
            {isSignUp && (
              <motion.div
                layoutId="activeTabIndicator"
                className="absolute inset-0 bg-white rounded-xl shadow-sm border border-slate-100/50 -z-10"
                transition={{ type: "spring", stiffness: 350, damping: 28 }}
              />
            )}
          </button>
        </div>

        {/* Formulário deve usar <form onSubmit={handleLogin}> */}
        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">E-mail</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              {/* Inputs CONTROLADOS */}
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                placeholder="seu@email.com"
                required
                disabled={!isConfigured || loading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">Senha</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              {/* Inputs CONTROLADOS */}
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                placeholder="••••••••"
                required
                disabled={!isConfigured || loading}
              />
            </div>
          </div>

          {/* Checkbox de Termos de Uso e Política de Privacidade (Apenas no Cadastro) */}
          {isSignUp && (
            <div className="flex items-start gap-3 pt-1">
              <input
                type="checkbox"
                id="legal-terms"
                checked={legalAccepted}
                onChange={(e) => setLegalAccepted(e.target.checked)}
                className="mt-1 w-4 h-4 text-blue-600 bg-slate-50 border-slate-300 rounded focus:ring-blue-500 cursor-pointer accent-blue-600 shrink-0"
              />
              <label htmlFor="legal-terms" className="text-xs text-slate-600 font-medium leading-relaxed cursor-pointer select-none">
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

          {/* Widget Cloudflare Turnstile (Exibido no Login e Cadastro) */}
          <div className="flex flex-col items-center justify-center pt-1 pb-1">
            <div ref={turnstileWidgetRef} id="cf-turnstile" className="min-h-[65px]"></div>
            {!turnstileToken && (
              <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                <ShieldCheck size={13} className="text-blue-500" />
                Aguardando verificação de segurança...
              </p>
            )}
          </div>

          {/* Exibir erro abaixo do formulário se existir */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-medium">
              {error}
            </div>
          )}

          {/* Botão "Entrar" / "Cadastrar" */}
          <button
            type="submit"
            disabled={loading || !isConfigured}
            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 flex items-center justify-center gap-2 overflow-hidden min-h-[60px]"
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={isSignUp ? 'signup-btn' : 'signin-btn'}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.15 }}
                className="flex items-center justify-center gap-2 w-full"
              >
                {loading ? <Loader2 className="animate-spin" size={24} /> : (isSignUp ? 'Cadastrar' : 'Entrar')}
              </motion.span>
            </AnimatePresence>
          </button>
        </form>

        <div className="mt-6 flex items-center gap-4">
          <div className="h-px bg-slate-100 flex-1"></div>
          <span className="text-xs font-black text-slate-300 uppercase tracking-widest">ou</span>
          <div className="h-px bg-slate-100 flex-1"></div>
        </div>

        <button
          onClick={handleGoogleLogin}
          disabled={loading || !isConfigured}
          className="mt-6 w-full bg-white border-2 border-slate-100 text-slate-700 py-4 rounded-2xl font-black text-lg hover:bg-slate-50 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 flex items-center justify-center gap-3"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.14-4.53z" fill="#EA4335"/>
          </svg>
          Entrar com Google
        </button>

        <div className="mt-8 text-center relative h-6">
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError(null);
            }}
            className="text-slate-500 font-bold hover:text-blue-600 transition-colors inline-block w-full text-center"
            disabled={loading || !isConfigured}
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={isSignUp ? 'signup-toggle' : 'signin-toggle'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15 }}
                className="block w-full text-center"
              >
                {isSignUp ? 'Já tem uma conta? Entre aqui' : 'Não tem conta? Cadastre-se'}
              </motion.span>
            </AnimatePresence>
          </button>

          <button
            type="button"
            onClick={() => setShowDebugInfo(!showDebugInfo)}
            className="absolute -bottom-4 right-0 p-2 text-slate-200 hover:text-slate-400 transition-colors"
            title="Debug"
          >
            <Bug size={14} />
          </button>
        </div>

        {/* Diagnostic Button - Revealed by Bug icon */}
        {showDebugInfo && (
          <div className="mt-8 p-4 bg-slate-50 border border-slate-100 rounded-2xl animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest">
                <Activity size={14} />
                Status do Servidor
              </div>
              <button 
                type="button"
                onClick={checkConnection}
                disabled={connStatus.loading}
                className="text-[10px] font-black text-blue-600 uppercase hover:underline disabled:opacity-50"
              >
                Testar Agora
              </button>
            </div>
            
            {connStatus.loading ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs italic">
                <Loader2 size={12} className="animate-spin" /> Verificando conexão...
              </div>
            ) : connStatus.ok === true ? (
              <div className="flex items-center gap-2 text-green-600 text-xs font-bold">
                <Wifi size={14} /> Conectado ao Supabase!
              </div>
            ) : connStatus.ok === false ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-red-600 text-xs font-bold">
                  <WifiOff size={14} /> Falha na Conexão
                </div>
                <p className="text-[10px] text-slate-500 leading-tight">
                  {connStatus.message}
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-slate-400 italic">
                Clique acima para testar a comunicação com o banco de dados.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
