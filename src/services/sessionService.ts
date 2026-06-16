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

    // 1. Try to find if a session already exists with this user_id and session_id
    const { data: existing, error: selectError } = await supabase
      .from('active_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .maybeSingle();

    if (selectError) {
      console.warn('[SessionService] Checking existing session warning:', selectError);
    }

    let data, error;
    if (existing) {
      // 2. If it exists, update it. This does NOT require any ON CONFLICT constraints!
      const updateResult = await supabase
        .from('active_sessions')
        .update({
          last_activity: new Date().toISOString(),
          user_agent: ua.substring(0, 255),
          os,
          browser,
          device_type: deviceType
        })
        .eq('user_id', userId)
        .eq('session_id', sessionId)
        .select()
        .single();
      data = updateResult.data;
      error = updateResult.error;
    } else {
      // 3. If it doesn't exist, insert it. This does NOT require any ON CONFLICT constraints!
      const insertResult = await supabase
        .from('active_sessions')
        .insert(sessionRow)
        .select()
        .single();
      data = insertResult.data;
      error = insertResult.error;
    }

    if (error) {
      console.error('[SessionService] Error registering session (raw):', error);
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
