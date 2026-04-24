import React, { useState, useEffect, useCallback } from 'react';
import Navigation from '../../components/Navigation';
import Dashboard from '../../components/Dashboard';
import Medications from '../../components/Medications';
import AddMedication from '../../components/AddMedication';
import Appointments from '../../components/Appointments';
import AddAppointment from '../../components/AddAppointment';
import Calendar from '../../components/Calendar';
import Settings from '../../components/Settings';
import ConfirmationModal from '../../components/ConfirmationModal';
import { ViewType, Medication, DoseEvent, Appointment, AppSettings, UsageCategory, UserPreferences } from '../../types';
import { COLORS } from '../../constants';
import { useAuthContext } from '../context/AuthContext';
import { medicationService, mapMedToCamelCase } from '../services/medicationService';
import { consumptionService, mapDoseToCamelCase } from '../services/consumptionService';
import { appointmentService, mapAppToCamelCase } from '../services/appointmentService';
import { userPreferencesService } from '../services/userPreferencesService';
import { supabase } from '../lib/supabase';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

import { getUpdatedStock } from '../domain/stock';
import { getNextDoseAt } from '../domain/medicationRules';
import { pushService } from '../services/pushService';

const STORAGE_KEYS = {
  SETTINGS: 'medmanager_v2_settings'
};

const DEFAULT_SETTINGS: AppSettings = {
  thresholdExpiring: 3,
  thresholdRunningOut: 3,
  showDelayDisclaimer: true,
  showGreeting: true,
  preNotificationMinutes: 5,
  pushNotificationsEnabled: true,
  updatedAt: new Date(0).toISOString() // Epoch as default
};

const MainApp: React.FC = () => {
  const { user, onboardingCompleted, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  
  const [meds, setMeds] = useState<Medication[]>([]);
  const [doses, setDoses] = useState<DoseEvent[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [editingMedication, setEditingMedication] = useState<Medication | null>(null);
  const [initialMedCategory, setInitialMedCategory] = useState<UsageCategory | undefined>(undefined);
  
  const [view, setView] = useState<ViewType>(() => {
    if (location.state?.openAddMed) return 'add-med';
    return 'dashboard';
  });
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (location.state?.openAddMed) {
      setView('add-med');
      setEditingMedication(null);
      setInitialMedCategory(undefined);
    }
  }, [location.state]);
  
  const loadData = <T,>(key: string, defaultValue: T): T => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(`[Remédio em Dia] Erro ao carregar ${key}:`, e);
    }
    return defaultValue;
  };

  const [settings, setSettings] = useState<AppSettings>(() => {
    const loaded = loadData(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...loaded };
  });

  const settingsRef = React.useRef<AppSettings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const lastSyncedSettings = React.useRef<string>(JSON.stringify(settings));

  useEffect(() => {
    if (user && meds.length > 0) {
      pushService.syncMedicationReminders(user.id, meds, settings.preNotificationMinutes).catch(err => 
        console.error('Erro ao sincronizar lembretes após mudança de configuração:', err)
      );
    }
  }, [user, meds, settings.preNotificationMinutes]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setDataLoading(true);
    try {
      // Fetch core data first
      const [medsData, dosesData, appointmentsData] = await Promise.all([
        medicationService.getMedications(user.id),
        consumptionService.getConsumptionRecords(user.id),
        appointmentService.getAppointments(user.id)
      ]);
      setMeds(medsData);
      setDoses(dosesData);
      setAppointments(appointmentsData);
      
      // Fetch preferences separately to avoid blocking if table doesn't exist or error occurs
      try {
        const prefsData = await userPreferencesService.getPreferences(user.id);
        if (prefsData) {
          const newSettings: AppSettings = {
            thresholdExpiring: prefsData.threshold_expiring ?? DEFAULT_SETTINGS.thresholdExpiring,
            thresholdRunningOut: prefsData.threshold_running_out ?? DEFAULT_SETTINGS.thresholdRunningOut,
            showDelayDisclaimer: prefsData.show_delay_disclaimer ?? DEFAULT_SETTINGS.showDelayDisclaimer,
            showGreeting: prefsData.show_greeting ?? DEFAULT_SETTINGS.showGreeting,
            preNotificationMinutes: prefsData.pre_notification_minutes ?? DEFAULT_SETTINGS.preNotificationMinutes,
            pushNotificationsEnabled: prefsData.push_notifications_enabled ?? DEFAULT_SETTINGS.pushNotificationsEnabled,
            updatedAt: prefsData.updated_at || DEFAULT_SETTINGS.updatedAt
          };
          
          // Update ref to avoid syncing back the same data we just fetched
          lastSyncedSettings.current = JSON.stringify(newSettings);
          setSettings(newSettings);
        }
      } catch (prefError) {
        console.warn('Não foi possível carregar as preferências do banco:', prefError);
      }
    } catch (error) {
      console.error('Erro ao buscar dados principais:', error);
    } finally {
      setDataLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'medications', filter: `user_id=eq.${user.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const newMed = mapMedToCamelCase(payload.new);
          setMeds(prev => [newMed, ...prev.filter(m => m.id !== newMed.id)]);
        } else if (payload.eventType === 'UPDATE') {
          const updatedMed = mapMedToCamelCase(payload.new);
          setMeds(prev => prev.map(m => m.id === updatedMed.id ? updatedMed : m));
        } else if (payload.eventType === 'DELETE') {
          setMeds(prev => prev.filter(m => m.id !== payload.old.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consumption_records', filter: `user_id=eq.${user.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const newDose = mapDoseToCamelCase(payload.new);
          setDoses(prev => [newDose, ...prev.filter(d => d.id !== newDose.id)]);
        } else if (payload.eventType === 'UPDATE') {
          const updatedDose = mapDoseToCamelCase(payload.new);
          setDoses(prev => prev.map(d => d.id === updatedDose.id ? updatedDose : d));
        } else if (payload.eventType === 'DELETE') {
          setDoses(prev => prev.filter(d => d.id !== payload.old.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `user_id=eq.${user.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const newApp = mapAppToCamelCase(payload.new);
          setAppointments(prev => [newApp, ...prev.filter(a => a.id !== newApp.id)]);
        } else if (payload.eventType === 'UPDATE') {
          const updatedApp = mapAppToCamelCase(payload.new);
          setAppointments(prev => prev.map(a => a.id === updatedApp.id ? updatedApp : a));
        } else if (payload.eventType === 'DELETE') {
          setAppointments(prev => prev.filter(a => a.id !== payload.old.id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_preferences', filter: `user_id=eq.${user.id}` }, (payload) => {
        if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
          const prefs = payload.new as UserPreferences;
          
          // Use updatedAt to decide if we should apply the update
          const incomingUpdatedAt = prefs.updated_at || new Date(0).toISOString();
          const currentUpdatedAt = settingsRef.current.updatedAt || new Date(0).toISOString();

          if (new Date(incomingUpdatedAt).getTime() > new Date(currentUpdatedAt).getTime()) {
            const newSettings: AppSettings = {
              thresholdExpiring: prefs.threshold_expiring,
              thresholdRunningOut: prefs.threshold_running_out,
              showDelayDisclaimer: prefs.show_delay_disclaimer,
              showGreeting: prefs.show_greeting,
              preNotificationMinutes: prefs.pre_notification_minutes,
              pushNotificationsEnabled: prefs.push_notifications_enabled,
              updatedAt: incomingUpdatedAt
            };
            
            lastSyncedSettings.current = JSON.stringify(newSettings);
            setSettings(newSettings);
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const openConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  useEffect(() => {
    if (!user) return;
    
    const currentSettingsStr = JSON.stringify(settings);
    localStorage.setItem(STORAGE_KEYS.SETTINGS, currentSettingsStr);
    
    // Only sync to DB if settings actually changed locally (not from a remote sync)
    if (currentSettingsStr !== lastSyncedSettings.current) {
      const timer = setTimeout(() => {
        userPreferencesService.updatePreferences(user.id, {
          threshold_expiring: settings.thresholdExpiring,
          threshold_running_out: settings.thresholdRunningOut,
          show_delay_disclaimer: settings.showDelayDisclaimer,
          show_greeting: settings.showGreeting,
          pre_notification_minutes: settings.preNotificationMinutes,
          push_notifications_enabled: settings.pushNotificationsEnabled
        }).then(result => {
          if (result) {
            const updatedSettings: AppSettings = {
              thresholdExpiring: result.threshold_expiring,
              thresholdRunningOut: result.threshold_running_out,
              showDelayDisclaimer: result.show_delay_disclaimer,
              showGreeting: result.show_greeting,
              preNotificationMinutes: result.pre_notification_minutes,
              pushNotificationsEnabled: result.push_notifications_enabled,
              updatedAt: result.updated_at
            };
            
            // Update both state and ref AFTER successful response
            const updatedSettingsStr = JSON.stringify(updatedSettings);
            lastSyncedSettings.current = updatedSettingsStr;
            setSettings(updatedSettings);
          }
        }).catch(err => console.error('Erro ao salvar preferências no banco:', err));
      }, 1000); // 1 second debounce

      return () => clearTimeout(timer);
    }
  }, [settings, user]);

  const handleSaveMedication = useCallback(async (newMed: Medication) => {
    if (!user) return;
    try {
      const exists = meds.some(m => m.id === newMed.id);
      if (exists) {
        const updated = await medicationService.updateMedication(user.id, newMed.id, newMed);
        const newMeds = meds.map(m => m.id === updated.id ? updated : m);
        setMeds(newMeds);
        await pushService.syncMedicationReminders(user.id, newMeds);
      } else {
        const finalMed = { ...newMed, color: newMed.color || COLORS[Math.floor(Math.random() * COLORS.length)] };
        const created = await medicationService.createMedication(user.id, finalMed);
        const newMeds = [created, ...meds];
        setMeds(newMeds);
        await pushService.syncMedicationReminders(user.id, newMeds);
      }
      setEditingMedication(null);
      setView('meds');
    } catch (error) {
      console.error('Erro ao salvar medicamento:', error);
      alert('Houve um erro ao salvar o medicamento. Por favor, verifique os dados e tente novamente.');
    }
  }, [user, meds]);

  const handleDeleteMed = useCallback(async (id: string) => {
    if (!user) return;
    openConfirm(
      'Excluir Medicamento',
      'Tem certeza que deseja excluir este medicamento? Esta ação não pode ser desfeita. (O histórico do medicamento também será apagado)',
      async () => {
        try {
          await medicationService.deleteMedication(user.id, id);
          const newMeds = meds.filter(m => m.id !== id);
          setMeds(newMeds);
          setDoses(prev => prev.filter(d => d.medicationId !== id));
          await pushService.syncMedicationReminders(user.id, newMeds);
        } catch (error) {
          console.error('Erro ao excluir medicamento:', error);
        }
      }
    );
  }, [user, meds]);

  const handleEditMedication = useCallback((med: Medication) => {
    setEditingMedication(med);
    setView('add-med');
  }, []);

  const handleEditAppointment = useCallback((app: Appointment) => {
    setEditingAppointment(app);
    setView('add-appointment');
  }, []);

  const handleAddMed = useCallback((category?: UsageCategory) => {
    setEditingMedication(null);
    setInitialMedCategory(category);
    setView('add-med');
  }, []);

  const handleClearData = useCallback(() => {
    if (!user) return;
    
    openConfirm(
      'Limpar Dados',
      'Isso apagará todos os seus remédios e consultas. Esta ação não pode ser desfeita. Continuar?',
      async () => {
        try {
          setDataLoading(true);
          
          // Deletar tudo do banco para este usuário
          await Promise.all([
            supabase.from('consumption_records').delete().eq('user_id', user.id),
            supabase.from('appointments').delete().eq('user_id', user.id),
            supabase.from('medications').delete().eq('user_id', user.id)
          ]);
          
          // Limpar estados locais
          setMeds([]);
          setDoses([]);
          setAppointments([]);
          
          // Sincronizar lembretes (limpar fila de push)
          await pushService.syncMedicationReminders(user.id, []);
          
          alert('Dados excluídos com sucesso.');
        } catch (error) {
          console.error('Erro ao limpar dados:', error);
        } finally {
          setDataLoading(false);
        }
      }
    );
  }, [user]);

  const handleSaveAppointment = useCallback(async (newApp: Appointment) => {
    if (!user) return;
    try {
      const exists = appointments.some(app => app.id === newApp.id);
      if (exists) {
        const updated = await appointmentService.updateAppointment(user.id, newApp.id, newApp);
        setAppointments(prev => prev.map(app => app.id === updated.id ? updated : app));
      } else {
        const created = await appointmentService.createAppointment(user.id, newApp);
        setAppointments(prev => [created, ...prev]);
      }
      setEditingAppointment(null);
      setView('appointments');
    } catch (error) {
      console.error('Erro ao salvar compromisso:', error);
    }
  }, [user, appointments]);

  const handleDeleteAppointment = useCallback(async (id: string) => {
    if (!user) return;
    openConfirm(
      'Excluir Compromisso',
      'Tem certeza que deseja excluir este compromisso?',
      async () => {
        try {
          await appointmentService.deleteAppointment(user.id, id);
          setAppointments(prev => prev.filter(app => app.id !== id));
        } catch (error) {
          console.error('Erro ao excluir compromisso:', error);
        }
      }
    );
  }, [user]);

  const handleToggleDose = useCallback(async (doseId: string, medicationId?: string, time?: string, date?: string) => {
    if (!user) return;
    const todayStr = new Date().toLocaleDateString('en-CA');
    const targetDate = date || todayStr;
    
    try {
      // 1. Tentar encontrar pelo ID exato (seja real ou virtual)
      let existingIndex = doses.findIndex(d => d.id === doseId);
      
      // 2. Se não encontrou pelo ID e temos med/time/date, tentar encontrar um registro real equivalente
      if (existingIndex === -1 && medicationId && time) {
        existingIndex = doses.findIndex(d => 
          d.medicationId === medicationId && 
          d.scheduledTime === time && 
          d.date === targetDate
        );
      }
      
      if (existingIndex > -1) {
        // Toggle de dose existente
        const currentDose = doses[existingIndex];
        const med = meds.find(m => m.id === currentDose.medicationId);
        const isPrn = med?.usageCategory === 'prn';
        
        const newStatus = currentDose.status === 'taken' ? 'pending' : 'taken';
        
        // Se for PRN e estivermos desmarcando (voltando para pending), deletamos o registro
        if (isPrn && newStatus === 'pending') {
          await consumptionService.deleteConsumptionRecord(user.id, currentDose.id);
          
          // Atualiza estoque (devolve 1)
          if (med) {
            const updatedMed = await medicationService.updateMedication(user.id, med.id, { 
              currentStock: getUpdatedStock(med.currentStock, 'pending') 
            });
            setMeds(prev => prev.map(m => m.id === updatedMed.id ? updatedMed : m));
          }
          
          setDoses(prev => prev.filter((_, i) => i !== existingIndex));
          return;
        }

        // Atualiza status no banco
        const updatedDose = await consumptionService.updateConsumptionRecord(user.id, currentDose.id, { 
          status: newStatus 
        });

        // Atualiza estoque baseado na mudança de status para meds regulares
        if (med) {
          const updatedMed = await medicationService.updateMedication(user.id, med.id, { 
            currentStock: getUpdatedStock(med.currentStock, newStatus),
            // Recalcular próxima dose ao marcar como tomado
            next_dose_at: newStatus === 'taken' ? getNextDoseAt(med) : med.next_dose_at
          });
          setMeds(currentMeds => currentMeds.map(m => m.id === updatedMed.id ? updatedMed : m));
        }

        setDoses(prev => prev.map(d => d.id === updatedDose.id ? updatedDose : d));
        return;
      } else if (medicationId && time) {
        // Criação de novo evento de dose
        const createdDose = await consumptionService.createConsumptionRecord(user.id, {
          medicationId,
          date: targetDate,
          scheduledTime: time,
          status: 'taken'
        });

        // Reduz o estoque ao marcar como tomado
        const med = meds.find(m => m.id === medicationId);
        if (med) {
          const updatedMed = await medicationService.updateMedication(user.id, med.id, { 
            currentStock: getUpdatedStock(med.currentStock, 'taken'),
            next_dose_at: getNextDoseAt(med)
          });
          setMeds(prev => prev.map(m => m.id === updatedMed.id ? updatedMed : m));
        }

        setDoses(prev => [...prev, createdDose]);
      }
    } catch (error) {
      console.error('Erro ao alternar dose:', error);
    }
  }, [user, doses, meds]);

  const renderView = () => {
    switch (view) {
      case 'dashboard':
        return <Dashboard 
          meds={meds} 
          doses={doses} 
          appointments={appointments} 
          settings={settings} 
          onToggleDose={handleToggleDose} 
          onEditMed={handleEditMedication}
          onUpdateSettings={setSettings}
          onDeleteAppointment={handleDeleteAppointment}
          onEditAppointment={handleEditAppointment}
          onAddMed={handleAddMed}
        />;
      case 'meds':
        return <Medications meds={meds} settings={settings} onAdd={() => handleAddMed()} onEdit={handleEditMedication} onDelete={handleDeleteMed} />;
      case 'add-med':
        return <AddMedication onSave={handleSaveMedication} onCancel={() => setView('meds')} initialData={editingMedication} initialCategory={initialMedCategory} />;
      case 'appointments':
        return <Appointments appointments={appointments} onAddClick={() => { setEditingAppointment(null); setView('add-appointment'); }} onEditClick={handleEditAppointment} onDeleteClick={handleDeleteAppointment} />;
      case 'add-appointment':
        return <AddAppointment onSave={handleSaveAppointment} onCancel={() => setView('appointments')} initialData={editingAppointment} />;
      case 'calendar':
        return <Calendar appointments={appointments} meds={meds} doses={doses} onToggleDose={handleToggleDose} onEditMed={handleEditMedication} />;
      case 'settings':
        return <Settings 
          settings={settings} 
          onUpdateSettings={setSettings} 
          onClearData={handleClearData} 
        />;
      default:
        return <Dashboard 
          meds={meds} 
          doses={doses} 
          appointments={appointments} 
          settings={settings} 
          onToggleDose={handleToggleDose} 
          onEditMed={handleEditMedication} 
          onUpdateSettings={setSettings} 
          onDeleteAppointment={handleDeleteAppointment}
          onEditAppointment={handleEditAppointment}
          onAddMed={handleAddMed}
        />;
    }
  };

  const [isDataStuck, setIsDataStuck] = useState(false);
  useEffect(() => {
    let timer: number;
    if (dataLoading) {
      timer = window.setTimeout(() => {
        const autoResetDone = sessionStorage.getItem('auto_reset_data_stuck');
        if (!autoResetDone) {
          sessionStorage.setItem('auto_reset_data_stuck', 'true');
          console.warn('[Watchdog] Carregamento de dados demorando muito. Limpando cache local...');
          localStorage.clear();
          window.location.reload();
        } else {
          setIsDataStuck(true);
        }
      }, 5000); // 5 segundos de tolerância para sincronização de dados
    } else {
      setIsDataStuck(false);
    }
    return () => window.clearTimeout(timer);
  }, [dataLoading]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      <Navigation currentView={view === 'add-appointment' ? 'appointments' : (view === 'add-med' ? 'meds' : view)} setView={setView} />
      <main className="flex-1 md:ml-64 p-4 md:p-10 transition-all duration-300">
        <div className="max-w-6xl mx-auto">
          {dataLoading ? (
            <div className="flex flex-col items-center justify-center p-12 text-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-6"></div>
              <p className="text-slate-500 font-bold text-sm mb-8 animate-pulse font-mono uppercase tracking-widest">Carregando...</p>
              {isDataStuck && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <p className="text-xs text-slate-400 mb-3 font-medium">Sincronizando dados...</p>
                  <button 
                    onClick={() => {
                      localStorage.clear();
                      sessionStorage.clear();
                      window.location.reload();
                    }}
                    className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
                  >
                    Sair e Reiniciar
                  </button>
                </div>
              )}
            </div>
          ) : (
            renderView()
          )}
        </div>
      </main>

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default MainApp;
