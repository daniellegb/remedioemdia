// ⚠️ Nunca usar profile.plan diretamente para controle de acesso.
// Sempre usar hasPremiumAccess(profile)

import { Profile } from '../../types';

/**
 * Determina se o usuário possui o plano premium ou acesso vitalício.
 * Regra: plan === 'premium' OU plan === 'lifetime_access'
 */
export const isPremium = (profile: Profile | null | undefined): boolean => {
  if (!profile) return false;
  // Verificamos ambos para garantir compatibilidade com as regras do prompt e o campo booleano existente
  return profile.plan === 'premium' || 
         profile.plan === 'lifetime_access' || 
         profile.lifetime_access === true;
};

/**
 * Determina se o período de teste (trial) está ativo.
 * Regra: trial_ends_at != null E data atual < trial_ends_at
 */
export const isTrialActive = (profile: Profile | null | undefined): boolean => {
  if (!profile || !profile.trial_ends_at) {
    return false;
  }
  const now = new Date();
  const endsAt = new Date(profile.trial_ends_at);
  return now < endsAt;
};

/**
 * Determina se a assinatura está ativa ou em período de graça após cancelamento.
 * Status:
 * - active: Assinatura paga e renovável.
 * - canceled: Usuário cancelou, mas mantém acesso até subscription_ends_at.
 */
export const isSubscriptionActive = (profile: Profile | null | undefined): boolean => {
  if (!profile) return false;
  
  const now = new Date();
  
  // Se estiver ativo, verificamos a data de expiração (se existir)
  if (profile.subscription_status === 'active') {
    if (!profile.subscription_ends_at) return true;
    return now < new Date(profile.subscription_ends_at);
  }
  
  // Se estiver cancelado, ele ainda pode ter acesso até o fim do período já pago
  if (profile.subscription_status === 'canceled' && profile.subscription_ends_at) {
    return now < new Date(profile.subscription_ends_at);
  }
  
  return false;
};

/**
 * Verifica se o usuário tem acesso a funcionalidades premium por qualquer meio.
 */
export const hasPremiumAccess = (profile: Profile | null | undefined): boolean => {
  if (!profile) return false;
  return (
    isPremium(profile) || 
    isTrialActive(profile) || 
    isSubscriptionActive(profile)
  );
};

/**
 * Retorna o plano efetivo do usuário para fins de permissões e UI.
 * Regra: 'premium' se tiver acesso (premium, trial ou lifetime), 'free' caso contrário.
 */
export const getEffectivePlan = (profile: Profile | null | undefined): 'free' | 'premium' => {
  return hasPremiumAccess(profile) ? 'premium' : 'free';
};
