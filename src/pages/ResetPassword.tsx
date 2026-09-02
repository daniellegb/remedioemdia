import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Pill, Lock, Loader2, CheckCircle, AlertTriangle, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';

const ResetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const navigate = useNavigate();
  const { session, updatePassword, signOut, loading: authLoading } = useAuth();

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password || !confirmPassword) {
      setError('Por favor, preencha todos os campos.');
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas não coincidem. Digite novamente.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await updatePassword(password);
      setSuccess(true);
    } catch (err: any) {
      console.error('Error resetting password:', err);
      setError(err.message || 'Erro ao redefinir a senha. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoToLogin = async () => {
    try {
      await signOut();
    } catch (e) {
      // Ignore cleanup error on navigation
    }
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-[40px] shadow-xl border border-slate-100 p-8 md:p-12">
        <div className="flex flex-col items-center mb-8">
          {!logoError ? (
            <img
              src="/remedio-em-dia-logo-vertical.png"
              alt="Remédio em Dia Logo"
              className="max-h-[180px] w-auto object-contain mb-4 rounded-2xl"
              onError={() => setLogoError(true)}
            />
          ) : (
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 mb-4">
              <Pill size={32} className="text-white" />
            </div>
          )}
          <h1 className="text-2xl font-black text-slate-900 mb-1">Redefinir Senha</h1>
          <p className="text-slate-500 font-medium text-sm text-center">
            Crie uma nova senha segura para sua conta
          </p>
        </div>

        {authLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="animate-spin text-blue-600 mb-4" size={32} />
            <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Validando sessão...</p>
          </div>
        ) : success ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-6 text-center"
          >
            <div className="p-4 bg-green-50 border border-green-100 rounded-3xl flex flex-col items-center gap-3">
              <div className="w-12 h-12 bg-green-500 rounded-2xl flex items-center justify-center text-white shadow-md">
                <CheckCircle size={28} />
              </div>
              <div>
                <h2 className="text-green-800 font-black text-lg">Senha Alterada!</h2>
                <p className="text-green-700 text-xs mt-1 leading-relaxed">
                  Sua senha foi redefinida com sucesso. Agora você já pode entrar com sua nova senha.
                </p>
              </div>
            </div>

            <button
              onClick={handleGoToLogin}
              className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all active:scale-[0.98] flex items-center justify-center gap-2 min-h-[60px]"
            >
              Ir para o Login
            </button>
          </motion.div>
        ) : !session ? (
          <div className="space-y-6 text-center">
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-3xl flex items-start gap-3 text-left">
              <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={20} />
              <div>
                <p className="text-amber-900 font-bold text-sm">Link inválido ou expirado</p>
                <p className="text-amber-700 text-xs mt-1 leading-relaxed">
                  Não encontramos uma sessão ativa de recuperação. Por favor, solicite um novo e-mail de redefinição na tela de login.
                </p>
              </div>
            </div>

            <button
              onClick={() => navigate('/login')}
              className="w-full bg-slate-100 text-slate-700 py-4 rounded-2xl font-black text-base hover:bg-slate-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <ArrowLeft size={18} />
              Voltar para o Login
            </button>
          </div>
        ) : (
          <form onSubmit={handleResetPassword} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">
                Nova Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  placeholder="••••••••"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">
                Confirmar Nova Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  placeholder="••••••••"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2 min-h-[60px]"
            >
              {loading ? <Loader2 className="animate-spin" size={24} /> : 'Alterar Senha'}
            </button>

            <button
              type="button"
              onClick={() => navigate('/login')}
              disabled={loading}
              className="w-full text-slate-500 font-bold hover:text-blue-600 transition-colors flex items-center justify-center gap-2 text-sm pt-2"
            >
              <ArrowLeft size={16} />
              Cancelar e voltar para Entrar
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
