
export type MedicationUnit = 'comprimido' | 'gota' | 'ml' | 'dose';
export type UsageCategory = 'continuous' | 'period' | 'intervals' | 'contraceptive' | 'prn';
export type IntervalType = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'quadrimesterly' | 'custom';
export type ContraceptiveType = 'daily' | '21_7' | '24_4' | '28_continuous';

export interface Medication {
  id: string;
  name: string;
  dosage: string;
  unit: MedicationUnit;
  frequency: number; // mantido para compatibilidade legado
  usageCategory?: UsageCategory;
  dosesPerDay?: string; // '1x', '2x', ..., 'custom'
  intervalDays?: number; // 1 a 6 ou X dias
  times?: string[];
  intervalType?: IntervalType;
  contraceptiveType?: ContraceptiveType;
  startDate?: string;
  endDate?: string;
  durationDays?: number; // Added for 'period' category
  maxDosesPerDay?: number;
  totalStock: number;
  currentStock: number;
  expiryDate?: string;
  notes?: string;
  color: string;
  next_dose_at?: string; // ISO string
}

export interface PushSubscriptionData {
  id?: string;
  user_id: string;
  endpoint: string;
  subscription: any; // Store the full PushSubscription JSON
  created_at?: string;
}

export type AppointmentType = 'Consulta' | 'Exame';

export interface Appointment {
  id: string;
  type: AppointmentType;
  doctor: string;
  specialty: string;
  date: string;
  time: string;
  location: string;
  notes?: string;
}

export interface DoseEvent {
  id: string;
  medicationId: string;
  date: string; // YYYY-MM-DD
  scheduledTime: string;
  status: 'pending' | 'taken' | 'missed';
}

export interface AppSettings {
  thresholdExpiring: number;
  thresholdRunningOut: number;
  showDelayDisclaimer: boolean;
  showGreeting: boolean;
  preNotificationMinutes: number;
  pushNotificationsEnabled: boolean;
  updatedAt?: string; // ISO string
}

export interface Profile {
  id: string;
  email?: string;
  name?: string;
  mode?: 'self' | 'caregiver';
  caregiver_name?: string;
  patient_name?: string;
  relationship?: string;
  onboarding_completed: boolean;
  role: 'user' | 'admin';
  plan: 'free' | 'premium';
  lifetime_access: boolean;
  created_at?: string;
}

export interface UserPreferences {
  id?: string;
  user_id: string;
  threshold_expiring: number;
  threshold_running_out: number;
  show_delay_disclaimer: boolean;
  show_greeting: boolean;
  pre_notification_minutes: number;
  push_notifications_enabled: boolean;
  updated_at?: string; // ISO string
}

export type ViewType = 'dashboard' | 'calendar' | 'meds' | 'appointments' | 'settings' | 'add-appointment' | 'add-med' | 'onboarding';
