import { useAuthContext } from '../context/AuthContext';

export const useAuth = () => {
  const { 
    user, 
    session, 
    profile, 
    loading, 
    profileLoaded,
    signOut, 
    signIn,
    signUp,
    signInWithGoogle,
    resetPasswordForEmail,
    updatePassword,
    isConfigured, 
    refreshProfile, 
    isAdmin, 
    isPremium,
    currentSessionId
  } = useAuthContext();

  return {
    user,
    session,
    loading,
    profileLoaded,
    isAuthenticated: !!user,
    onboardingCompleted: profile?.onboarding_completed ?? false,
    profile,
    signOut,
    signIn,
    signUp,
    signInWithGoogle,
    resetPasswordForEmail,
    updatePassword,
    isConfigured,
    refreshProfile,
    isAdmin,
    isPremium,
    currentSessionId
  };
};
