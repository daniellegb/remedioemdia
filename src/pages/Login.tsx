import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Pill, Mail, Lock, Loader2, AlertTriangle } from 'lucide-react';

const Login: React.FC = () => {
  // Estados locais controlados
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);

  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading, signIn, signUp, signInWithGoogle, isConfigured } = useAuth();

  // Redirecionar se já estiver autenticado
  React.useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Implementar função handleLogin
  const handleLogin = async (e: React.FormEvent) => {
    // Prevenir default
    e.preventDefault();
    
    if (isSignUp) {
      handleRegister();
      return;
    }

    // SetLoading(true)
    setLoading(true);
    // Limpar erro
    setError(null);

    try {
      // Chamar signIn(email, password)
      await signIn(email, password);
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
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error('Google login error:', err);
      setError(err.message || 'Erro ao entrar com Google.');
      setLoading(false);
    }
  };

  // Implementar função handleRegister
  const handleRegister = async () => {
    setLoading(true);
    setError(null);

    try {
      // Chamar signUp(email, password)
      await signUp(email, password);
      setError('Cadastro realizado com sucesso! Verifique seu e-mail para confirmar a conta.');
      setIsSignUp(false);
    } catch (err: any) {
      console.error('Register error:', err);
      setError(err.message || 'Erro ao realizar cadastro.');
    } finally {
      setLoading(false);
    }
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

        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 mb-6">
            <Pill size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 mb-2">Remédio em Dia</h1>
          <p className="text-slate-500 font-medium">
            {isSignUp ? 'Crie sua conta gratuita' : 'Bem-vindo de volta'}
          </p>
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
            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={24} /> : (isSignUp ? 'Cadastrar' : 'Entrar')}
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

        <div className="mt-8 text-center">
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError(null);
            }}
            className="text-slate-500 font-bold hover:text-blue-600 transition-colors"
            disabled={loading || !isConfigured}
          >
            {isSignUp ? 'Já tem uma conta? Entre aqui' : 'Não tem conta? Cadastre-se'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
