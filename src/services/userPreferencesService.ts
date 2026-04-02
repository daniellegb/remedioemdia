import { supabase } from '../lib/supabase';
import { UserPreferences } from '../../types';

export const userPreferencesService = {
  async getPreferences(userId: string): Promise<UserPreferences | null> {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async updatePreferences(userId: string, preferences: Partial<UserPreferences>) {
    try {
      const payload: any = {
        user_id: userId,
        ...preferences
      };
      
      // Only include updated_at if we are not in a known out-of-sync state
      // (This is a simple way to avoid the error until the user runs the SQL)
      payload.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('user_preferences')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .single();

      if (error) {
        // Handle missing column error gracefully
        if (error.code === 'PGRST204') {
          console.warn('Database schema out of sync. Some settings might not be saved to the cloud yet. Please run the updated SQL script in Supabase.', error.message);
          
          // Try one more time WITHOUT updated_at if that was the cause
          if (error.message.includes('updated_at')) {
            delete payload.updated_at;
            const { data: retryData, error: retryError } = await supabase
              .from('user_preferences')
              .upsert(payload, { onConflict: 'user_id' })
              .select()
              .single();
            
            if (!retryError) return retryData;
          }
          
          return null;
        }
        throw error;
      }
      return data;
    } catch (error) {
      console.error('Error updating preferences:', error);
      throw error;
    }
  }
};
