
import React, { useState, useEffect, useRef } from 'react';
import { Appointment, AppointmentType } from '../types';
import { ChevronLeft, Stethoscope, TestTubeDiagonal, User, Calendar, Clock, MapPin, Loader2 } from 'lucide-react';

interface Props {
  onSave: (appointment: Appointment) => void;
  onCancel: () => void;
  initialData?: Appointment | null;
}

const AddAppointment: React.FC<Props> = ({ onSave, onCancel, initialData }) => {
  const [type, setType] = useState<AppointmentType>('Consulta');
  const [formData, setFormData] = useState({
    doctor: '',
    specialty: '',
    date: '',
    time: '',
    location: '',
    notes: '',
    active: true
  });

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [lastSelectedLocation, setLastSelectedLocation] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialData) {
      setType(initialData.type);
      setFormData({
        doctor: initialData.doctor,
        specialty: initialData.specialty,
        date: initialData.date,
        time: initialData.time,
        location: initialData.location,
        notes: initialData.notes || '',
        active: initialData.active !== false
      });
      setLastSelectedLocation(initialData.location);
    }
  }, [initialData]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Busca debounced para sugestões de endereço
  useEffect(() => {
    const query = formData.location.trim();
    if (query.length < 3 || query === lastSelectedLocation) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      setIsLoadingSuggestions(true);
      setShowDropdown(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`,
          {
            headers: {
              'User-Agent': 'MedManagerApp/1.0'
            }
          }
        );
        if (response.ok) {
          const data = await response.json();
          const list = data.map((item: any) => item.display_name);
          setSuggestions(list);
        } else {
          setSuggestions([]);
        }
      } catch (error) {
        console.error('Erro ao buscar autocompletar de endereços:', error);
        setSuggestions([]);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, 600);

    return () => clearTimeout(delayDebounceFn);
  }, [formData.location, lastSelectedLocation]);

  const handleSelectSuggestion = (suggestion: string) => {
    setLastSelectedLocation(suggestion);
    setFormData(prev => ({ ...prev, location: suggestion }));
    setSuggestions([]);
    setShowDropdown(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const appToSave: Appointment = {
      id: initialData ? initialData.id : Math.random().toString(36).substr(2, 9),
      type,
      doctor: formData.doctor,
      specialty: formData.specialty,
      date: formData.date,
      time: formData.time,
      location: formData.location,
      notes: formData.notes,
      active: formData.active
    };
    onSave(appToSave);
  };

  return (
    <div className="max-w-2xl mx-auto pb-20 md:pb-0">
      <div className="flex items-center gap-4 mb-8">
        <button 
          onClick={onCancel}
          className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors"
        >
          <ChevronLeft size={24} />
        </button>
        <h2 className="text-2xl font-bold">{initialData ? 'Editar Compromisso' : 'Novo Compromisso'}</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Type Selector */}
        <div className="bg-white p-2 rounded-2xl border border-slate-100 flex gap-2">
          <button
            type="button"
            onClick={() => setType('Consulta')}
            className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
              type === 'Consulta' 
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' 
                : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Stethoscope size={18} />
            Consulta
          </button>
          <button
            type="button"
            onClick={() => setType('Exame')}
            className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
              type === 'Exame' 
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-100' 
                : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <TestTubeDiagonal size={18} />
            Exame
          </button>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm space-y-5">
          {/* Doctor / Facility */}
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <User size={14} /> {type === 'Consulta' ? 'Médico' : 'Local/Laboratório'}
            </label>
            <input
              required
              className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              placeholder={type === 'Consulta' ? 'Ex: Dr. Armando' : 'Ex: Lab Labor'}
              value={formData.doctor}
              onChange={e => setFormData({...formData, doctor: e.target.value})}
            />
          </div>

          {/* Specialty / Procedure */}
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <Stethoscope size={14} /> {type === 'Consulta' ? 'Especialidade' : 'Tipo de Exame'}
            </label>
            <input
              required
              className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              placeholder={type === 'Consulta' ? 'Ex: Cardiologia' : 'Ex: Sangue / Imagem'}
              value={formData.specialty}
              onChange={e => setFormData({...formData, specialty: e.target.value})}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Calendar size={14} /> Data
              </label>
              <input
                required
                type="date"
                className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                value={formData.date}
                onChange={e => setFormData({...formData, date: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Clock size={14} /> Hora
              </label>
              <input
                required
                type="time"
                className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                value={formData.time}
                onChange={e => setFormData({...formData, time: e.target.value})}
              />
            </div>
          </div>

          {/* Location */}
          <div className="space-y-2 relative" ref={dropdownRef}>
            <label className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <MapPin size={14} /> Endereço
            </label>
            <div className="relative">
              <input
                className="w-full bg-slate-50 border-none rounded-xl pl-4 pr-10 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-800"
                placeholder="Ex: Av. Paulista, 1000, São Paulo"
                value={formData.location}
                onChange={e => setFormData({...formData, location: e.target.value})}
                onFocus={() => {
                  if (suggestions.length > 0) setShowDropdown(true);
                }}
              />
              {isLoadingSuggestions && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Loader2 className="animate-spin" size={18} />
                </div>
              )}
            </div>

            {showDropdown && (
              <div className="absolute left-0 right-0 z-50 bg-white border border-slate-100 rounded-xl shadow-xl max-h-60 overflow-y-auto mt-1">
                {isLoadingSuggestions && suggestions.length === 0 ? (
                  <div className="p-4 text-sm text-slate-500 text-center flex items-center justify-center gap-2">
                    <Loader2 className="animate-spin text-blue-500" size={16} />
                    Buscando endereços...
                  </div>
                ) : suggestions.length > 0 ? (
                  <ul>
                    {suggestions.map((suggestion, index) => (
                      <li
                        key={index}
                        onClick={() => handleSelectSuggestion(suggestion)}
                        className="px-4 py-3 text-sm text-slate-700 hover:bg-blue-50 active:bg-blue-100 cursor-pointer border-b last:border-b-0 border-slate-50 transition-colors"
                      >
                        {suggestion}
                      </li>
                    ))}
                  </ul>
                ) : !isLoadingSuggestions && formData.location.trim().length >= 3 ? (
                  <div className="p-4 text-sm text-slate-500 text-center">
                    Nenhum endereço encontrado
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Status (Ativo / Inativo) */}
          {initialData && (
            <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="pr-4">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block">Status do Compromisso</label>
                <span className="text-[11px] text-slate-400 font-medium">Compromissos inativos não geram lembretes nem aparecem no calendário futuro.</span>
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, active: !formData.active })}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${
                  formData.active
                    ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {formData.active ? 'Ativo' : 'Inativo'}
              </button>
            </div>
          )}
        </div>

        <button
          type="submit"
          className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg shadow-xl hover:bg-blue-700 hover:shadow-blue-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {initialData ? 'Salvar Alterações' : 'Confirmar Agendamento'}
        </button>
      </form>
    </div>
  );
};

export default AddAppointment;
