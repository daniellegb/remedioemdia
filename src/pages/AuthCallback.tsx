import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';

const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;

    const handleAuthCallback = async () => {
      // Como detectSessionInUrl: false, precisamos processar o hash manualmente
      const hash = window.location.hash;
      
      if (hash && hash.includes('access_token')) {
        try {
          const params = new URLSearchParams(hash.substring(1)); // Remove o '#'
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');

          if (accessToken && refreshToken) {
            console.log('[AUTH] Processando tokens do callback web...');
            
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken
            });

            // Limpa o hash da URL para segurança e estética
            if (window.history.replaceState) {
              window.history.replaceState(null, '', window.location.pathname + window.location.search);
            }

            if (error) {
              console.error('[AUTH] Erro ao sincronizar sessão no callback:', error.message);
              navigate('/login', { replace: true });
            } else {
              console.log('[AUTH] Sessão web sincronizada com sucesso.');
              processed.current = true;
              navigate('/dashboard', { replace: true });
            }
            return;
          }
        } catch (err) {
          console.error('[AUTH] Falha crítica ao processar hash de autenticação:', err);
        }
      }

      // Fallback: verificar se o Supabase já capturou a sessão de outra forma
      const { data, error } = await supabase.auth.getSession();
      
      if (error || !data.session) {
        console.warn('[AUTH] Nenhuma sessão válida encontrada no callback. Redirecionando para login.');
        navigate('/login', { replace: true });
      } else {
        console.log('[AUTH] Sessão existente detectada no callback. Seguindo para o dashboard.');
        navigate('/dashboard', { replace: true });
      }
    };

    handleAuthCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200 flex flex-col items-center gap-6 max-w-sm w-full">
        <div className="bg-blue-50 p-4 rounded-full">
          <Loader2 className="animate-spin text-blue-600" size={40} />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-black text-slate-800 mb-2">Autenticando...</h2>
          <p className="text-slate-500 font-medium">Estamos finalizando seu login com o Google. Só um momento.</p>
        </div>
      </div>
    </div>
  );
};

export default AuthCallback;
