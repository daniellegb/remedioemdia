import React, { useState } from 'react';
import { ArrowLeft, Lock, Eye, EyeOff, CheckCircle2, AlertTriangle, Key, Check, X, Smile } from 'lucide-react';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/hooks/useAuth';
import { ViewType } from '../types';
import { motion } from 'motion/react';

interface Props {
  setView: (view: ViewType) => void;
}

const Security: React.FC<Props> = ({ setView }) => {
  const { user, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  // Check if user is authenticated via Google provider
  const isGoogleUser = user?.app_metadata?.provider === 'google' || 
                       (user?.identities && user.identities.some((identity: any) => identity.provider === 'google'));

  // Password rules validation states
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const passwordsMatch = password === confirmPassword && password !== '';

  const isFormValid = hasMinLength && hasUppercase && hasLowercase && hasNumber && passwordsMatch;

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) {
      if (!hasMinLength) {
        setError('A senha precisa ter pelo menos 8 caracteres.');
        return;
      }
      if (!hasUppercase) {
        setError('A senha precisa ter pelo menos 1 letra maiúscula.');
        return;
      }
      if (!hasLowercase) {
        setError('A senha precisa ter pelo menos 1 letra minúscula.');
        return;
      }
      if (!hasNumber) {
        setError('A senha precisa ter pelo menos 1 número.');
        return;
      }
      if (!passwordsMatch) {
        setError('As senhas não coincidem.');
        return;
      }
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    // Safety fallback: guaranteed to stop loading state in 2.5 seconds max
    const safetyTimer = setTimeout(() => {
      console.warn('[Security] Safety timer reached, forcing loading state to false');
      setLoading(false);
    }, 2500);

    try {
      console.log(`[Security] Tentando ${isGoogleUser ? 'definir' : 'alterar'} a senha via REST API direta...`);
      
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const token = currentSession?.access_token;
      
      if (!token) {
        throw new Error('Sessão ativa não encontrada. Por favor, faça login novamente.');
      }

      // Grab Supabase URL and Anon Key from environment
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Configurações do Supabase não encontradas.');
      }

      // Standard HTTP PUT to the GoTrue /user endpoint to update user attributes (including password)
      const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ password: password })
      });

      // Clear the safety timer as our request has completed
      clearTimeout(safetyTimer);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error_description || errorData.message || errorData.msg || 'Erro na resposta do servidor.');
      }

      const updatedUserData = await response.json();
      console.log('[Security] Senha salva com sucesso via REST API:', updatedUserData);

      // Attempt to silently refresh session in client to sync local memory safely
      try {
        await supabase.auth.refreshSession();
      } catch (refreshErr) {
        console.warn('[Security] Erro não-bloqueante ao atualizar sessão local:', refreshErr);
      }

      setSuccess(true);
      setPassword('');
      setConfirmPassword('');
      // Set loading to false immediately to allow UI updates to render without batching delays
      setLoading(false);

      // Redirect back to settings after 3 seconds
      setTimeout(() => {
        setView('settings');
      }, 3000);
    } catch (err: any) {
      clearTimeout(safetyTimer);
      console.error('[Security] Erro ao atualizar senha:', err);
      
      const errorMsg = err?.message || String(err);
      if (errorMsg.includes('session_id') || errorMsg.includes('JWT') || errorMsg.includes('Session from session_id')) {
        setIsSessionExpired(true);
        setError('Sua sessão de login expirou ou foi invalidada no banco de dados. Para sua segurança, é necessário sair e entrar novamente.');
      } else {
        setError(errorMsg || 'Ocorreu um erro ao alterar sua senha. Por favor, tente novamente.');
      }
      setLoading(false);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } }
  };

  return (
    <motion.div 
      id="security-page-container"
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
          className="p-2.5 bg-white hover:bg-slate-50 border border-slate-100 rounded-2xl text-slate-500 hover:text-slate-800 transition-colors shadow-sm cursor-pointer"
          title="Voltar para Ajustes"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Segurança</h2>
          <p className="text-xs md:text-sm text-slate-500">Gerencie a segurança da sua conta e credenciais</p>
        </div>
      </div>

      {success && (
        <div id="security-success-banner" className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-emerald-800 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
          <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={18} />
          <div>
            <p className="font-semibold">
              {isGoogleUser ? 'Senha definida com sucesso!' : 'Senha alterada com sucesso!'}
            </p>
            <p className="text-xs mt-1 text-emerald-600/80 leading-relaxed">
              {isGoogleUser 
                ? 'Sua nova senha foi salva! Agora você também pode acessar sua conta usando e-mail e senha. Redirecionando para Ajustes em instantes...'
                : 'Sua nova senha foi salva com sucesso! Redirecionando para Ajustes em instantes...'
              }
            </p>
          </div>
        </div>
      )}

      {error && (
        <div id="security-error-banner" className="bg-red-50 border border-red-100 rounded-2xl p-4 text-red-700 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div className="space-y-2 w-full">
            <p className="font-semibold">
              {isGoogleUser ? 'Não foi possível definir a senha' : 'Não foi possível alterar a senha'}
            </p>
            <p className="text-xs text-red-600/90 leading-relaxed">{error}</p>
            
            {isSessionExpired && (
              <div className="pt-2 border-t border-red-100 mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  id="btn-re-authenticate"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await signOut();
                    } catch (e) {
                      localStorage.clear();
                    }
                    window.location.href = '/login';
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs py-2 px-4 rounded-xl shadow-sm transition-all cursor-pointer active:scale-95"
                >
                  Sair e Entrar Novamente
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Change / Define Password Card */}
      <div id="security-password-card" className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
          <Key size={18} className="text-slate-400" />
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest text-slate-600">
            {isGoogleUser ? 'Definir Senha' : 'Alterar Senha'}
          </h3>
        </div>

        <div className="p-6 md:p-8 space-y-6">
          {isGoogleUser && (
            <div className="bg-blue-50/60 border border-blue-100/80 rounded-2xl p-4 text-blue-800 text-xs md:text-sm flex gap-3 items-start">
              <Smile className="text-blue-500 shrink-0 mt-0.5" size={18} />
              <div className="space-y-1">
                <p className="font-semibold">Você entrou com Google.</p>
                <p className="leading-normal text-slate-600 font-medium">
                  Defina uma senha caso também queira acessar com e-mail e senha além do login pelo Google.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleUpdatePassword} className="space-y-6" id="form-change-password">
            {/* New Password Input */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700" htmlFor="new-password">
                Nova Senha
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl pl-4 pr-12 py-3.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm"
                  placeholder={isGoogleUser ? "Defina sua nova senha" : "Digite sua nova senha"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Confirm New Password Input */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700" htmlFor="confirm-new-password">
                Confirmar Nova Senha
              </label>
              <div className="relative">
                <input
                  id="confirm-new-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl pl-4 pr-12 py-3.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm"
                  placeholder="Confirme a nova senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Dynamic visual validations checklist */}
            <div className="bg-slate-50 rounded-2xl p-4 md:p-5 space-y-3 border border-slate-100">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Requisitos da senha</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2.5 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <div className={`p-0.5 rounded-full ${hasMinLength ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'} transition-all`}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span className={hasMinLength ? 'text-slate-800 font-medium' : 'text-slate-400'}>Mínimo de 8 caracteres</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className={`p-0.5 rounded-full ${hasUppercase ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'} transition-all`}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span className={hasUppercase ? 'text-slate-800 font-medium' : 'text-slate-400'}>Pelo menos 1 letra maiúscula</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className={`p-0.5 rounded-full ${hasLowercase ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'} transition-all`}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span className={hasLowercase ? 'text-slate-800 font-medium' : 'text-slate-400'}>Pelo menos 1 letra minúscula</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className={`p-0.5 rounded-full ${hasNumber ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'} transition-all`}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span className={hasNumber ? 'text-slate-800 font-medium' : 'text-slate-400'}>Pelo menos 1 número</span>
                </div>

                <div className="flex items-center gap-2 md:col-span-2 pt-1 border-t border-slate-100 mt-1">
                  <div className={`p-0.5 rounded-full ${passwordsMatch ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'} transition-all`}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span className={passwordsMatch ? 'text-slate-800 font-medium' : 'text-slate-400'}>As senhas coincidem</span>
                </div>
              </div>
            </div>

            {/* Action Button */}
            <button
              id="btn-save-password"
              type="submit"
              disabled={loading || !isFormValid}
              className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-sm font-bold transition-all ${
                isFormValid && !loading
                  ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-100 active:scale-[0.99] cursor-pointer'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              {loading 
                ? (isGoogleUser ? 'Definindo senha...' : 'Alterando senha...') 
                : (isGoogleUser ? 'Definir Senha' : 'Alterar Senha')
              }
            </button>
          </form>
        </div>
      </div>
    </motion.div>
  );
};

export default Security;
