import { Profile } from '../../types';
import { hasPremiumAccess } from './subscriptionUtils';

/**
 * Constantes de limites para o plano gratuito
 */
export const FREE_PLAN_LIMITS = {
  MEDICATIONS: 3,
  CONSULTATIONS: 4,
};

export type UpgradeContext = 'limite_medicamentos' | 'limite_consultas';

export interface PermissionResult {
  allowed: boolean;
  message?: string;
  context?: UpgradeContext;
}

/**
 * Retorna mensagens de upgrade e trial baseadas no contexto de bloqueio.
 */
export const getUpgradeMessage = (context: UpgradeContext): string => {
  const messages = {
    limite_medicamentos: `Você atingiu o limite de ${FREE_PLAN_LIMITS.MEDICATIONS} medicamentos do plano gratuito.`,
    limite_consultas: `Você atingiu o limite de ${FREE_PLAN_LIMITS.CONSULTATIONS} consultas/exames do plano gratuito.`,
  };

  return `${messages[context]} Faça o upgrade para o Premium e tenha acesso ilimitado, ou comece seu teste grátis de 7 dias agora mesmo!`;
};

/**
 * Verifica se o usuário pode criar um novo medicamento.
 * Retorna um objeto PermissionResult para facilitar feedback na UI.
 */
export const checkMedicationLimit = (profile: Profile | null | undefined, currentCount: number): PermissionResult => {
  if (hasPremiumAccess(profile)) {
    return { allowed: true };
  }
  
  if (currentCount >= FREE_PLAN_LIMITS.MEDICATIONS) {
    return {
      allowed: false,
      message: getUpgradeMessage('limite_medicamentos'),
      context: 'limite_medicamentos'
    };
  }

  return { allowed: true };
};

/**
 * Verifica se o usuário pode criar uma nova consulta/exame.
 * Retorna um objeto PermissionResult para facilitar feedback na UI.
 */
export const checkConsultationLimit = (profile: Profile | null | undefined, currentCount: number): PermissionResult => {
  if (hasPremiumAccess(profile)) {
    return { allowed: true };
  }

  if (currentCount >= FREE_PLAN_LIMITS.CONSULTATIONS) {
    return {
      allowed: false,
      message: getUpgradeMessage('limite_consultas'),
      context: 'limite_consultas'
    };
  }

  return { allowed: true };
};

/**
 * Mantemos as funções originais para compatibilidade, se necessário, 
 * mas agora chamando a lógica centralizada.
 */
export const canCreateMedication = (profile: Profile | null | undefined, currentCount: number): boolean => {
  return checkMedicationLimit(profile, currentCount).allowed;
};

export const canCreateConsultation = (profile: Profile | null | undefined, currentCount: number): boolean => {
  return checkConsultationLimit(profile, currentCount).allowed;
};
