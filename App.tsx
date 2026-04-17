import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { AuthProvider } from './src/context/AuthContext';
import PrivateRoute from './src/components/PrivateRoute';
import Login from './src/pages/Login';
import AuthCallback from './src/pages/AuthCallback';
import MainApp from './src/components/MainApp';
import Onboarding from './src/components/Onboarding';
import { useAuth } from './src/hooks/useAuth';
import { supabase } from './src/lib/supabase';
import { platformService } from './src/services/platformService';

const AppRoutes: React.FC = () => {
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let sub: any = null;

    // Handler para Deep Links (Mobile)
    if (platformService.isNative()) {
      const setupDeepLink = async () => {
        try {
          sub = await CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
            console.log('[AUTH] Deep Link detectado:', url);
            
            if (url.includes('auth/callback')) {
              try {
                // No mobile, o token costuma vir após o '#'
                const hash = url.split('#')[1];
                if (!hash) {
                  console.warn('[AUTH] Deep link disparado mas sem hash de tokens.');
                  return;
                }

                const params = new URLSearchParams(hash);
                const accessToken = params.get('access_token');
                const refreshToken = params.get('refresh_token');

                if (accessToken && refreshToken) {
                  console.log('[AUTH] Sincronizando sessão mobile via Deep Link...');
                  const { error } = await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken
                  });

                  if (!error) {
                    console.log('[AUTH] Sessão mobile ativa. Redirecionando...');
                    navigate('/dashboard', { replace: true });
                  } else {
                    console.error('[AUTH] Erro ao aplicar sessão mobile:', error.message);
                  }
                }
              } catch (parseError) {
                console.error('[AUTH] Erro ao processar parâmetros do Deep Link:', parseError);
              }
            }
          });
        } catch (initError) {
          console.error('[AUTH] Erro ao inicializar listener de Deep Link:', initError);
        }
      };
      
      setupDeepLink();
    }

    return () => {
      if (sub) {
        console.log('[AUTH] Removendo listener de Deep Link.');
        sub.remove();
      }
    };
  }, [navigate]);

  const handleOnboardingComplete = async (skipMedication?: boolean) => {
    await refreshProfile();
    if (skipMedication) {
      navigate('/dashboard');
    } else {
      navigate('/dashboard', { state: { openAddMed: true } });
    }
  };

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      {/* Private Routes */}
      <Route element={<PrivateRoute />}>
        <Route path="/dashboard" element={<MainApp />} />
        <Route path="/onboarding" element={<Onboarding onComplete={handleOnboardingComplete} />} />
      </Route>

      {/* Default Redirects */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
};

export default App;
