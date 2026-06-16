import { supabase } from '../lib/supabase';
import { ActiveSession } from '../../types';
import { parseUserAgent } from '../utils/userAgent';

export const sessionService = {
  /**
   * Lists all active sessions for the current user.
   */
  async listSessions(): Promise<ActiveSession[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const { data, error } = await supabase
      .from('active_sessions')
      .select('*')
      .order('last_activity', { ascending: false });

    if (error) {
      console.error('[SessionService] Error listing active sessions:', error);
      throw error;
    }

    return (data || []) as ActiveSession[];
  },

  /**
   * Registers or updates details of the current session in the database.
   */
  async registerSession(userId: string, sessionId: string): Promise<ActiveSession | null> {
    if (!userId || !sessionId) return null;
    const ua = navigator.userAgent;
    const { os, browser, deviceType } = parseUserAgent(ua);

    const sessionRow = {
      session_id: sessionId,
      user_id: userId,
      user_agent: ua.substring(0, 255),
      os,
      browser,
      device_type: deviceType,
      last_activity: new Date().toISOString()
    };

    // First try with onConflict 'session_id' (new schema with session_id as Primary Key)
    let { data, error } = await supabase
      .from('active_sessions')
      .upsert(sessionRow, { onConflict: 'session_id' })
      .select()
      .single();

    // If it fails with constraint matching errors (e.g. 42P10), fallback to the old unique constraint (user_id,session_id)
    if (error && (error.code === '42P10' || error.message?.includes('ON CONFLICT'))) {
      console.warn('[SessionService] New schema not detected on Supabase. Falling back to old unique constraint user_id,session_id:', error.message);
      const fallbackResult = await supabase
        .from('active_sessions')
        .upsert(sessionRow, { onConflict: 'user_id,session_id' })
        .select()
        .single();
      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) {
      console.error('[SessionService] Error registering session:', error);
      return null;
    }

    return data as ActiveSession;
  },

  /**
   * Updates the last activity timestamp for the current session.
   */
  async updateActivity(userId: string, sessionId: string): Promise<void> {
    if (!userId || !sessionId) return;
    const { error } = await supabase
      .from('active_sessions')
      .update({ last_activity: new Date().toISOString() })
      .match({ user_id: userId, session_id: sessionId });

    if (error) {
      console.error('[SessionService] Error updating session activity:', error);
    }
  },

  /**
   * Checks whether the given session is still valid in the database.
   */
  async isSessionValid(userId: string, sessionId: string): Promise<boolean> {
    if (!userId || !sessionId) return false;
    const { data, error } = await supabase
      .from('active_sessions')
      .select('id')
      .match({ user_id: userId, session_id: sessionId });

    if (error) {
      console.warn('[SessionService] Error verifying session validity:', error);
      // If we got a network error or transient failure, we can default to true to allow offline navigation
      return true;
    }

    return data && data.length > 0;
  },

  /**
   * Revokes (deletes) a specific session.
   */
  async revokeSession(sessionId: string): Promise<void> {
    const { error } = await supabase
      .from('active_sessions')
      .delete()
      .eq('session_id', sessionId);

    if (error) {
      console.error('[SessionService] Error revoking session:', error);
      throw error;
    }
  },

  /**
   * Revokes all other sessions except the current one.
   */
  async revokeAllOtherSessions(currentSessionId: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const { error } = await supabase
      .from('active_sessions')
      .delete()
      .eq('user_id', user.id)
      .neq('session_id', currentSessionId);

    if (error) {
      console.error('[SessionService] Error revoking all other sessions:', error);
      throw error;
    }
  }
};
