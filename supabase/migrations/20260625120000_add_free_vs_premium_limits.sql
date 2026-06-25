-- Adiciona limites para Plano Gratuito vs Plano Premium
-- Limites: 3 medicamentos, 5 compromissos de saúde.

CREATE OR REPLACE FUNCTION public.has_premium_access(user_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
    u_plan TEXT;
    u_lifetime BOOLEAN;
    u_trial_ends TIMESTAMP WITH TIME ZONE;
    u_sub_status TEXT;
    u_sub_ends TIMESTAMP WITH TIME ZONE;
    now_tz TIMESTAMP WITH TIME ZONE := now();
BEGIN
    SELECT plan, lifetime_access, trial_ends_at, subscription_status, subscription_ends_at
    INTO u_plan, u_lifetime, u_trial_ends, u_sub_status, u_sub_ends
    FROM public.profiles
    WHERE id = user_uuid;

    -- Se não encontrar o perfil, assume como gratuito
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Verificação direta de plano premium ou acesso vitalício
    IF u_plan = 'premium' OR u_plan = 'lifetime_access' OR u_lifetime = TRUE THEN
        RETURN TRUE;
    END IF;

    -- Verificação de período de avaliação ativo
    IF u_trial_ends IS NOT NULL AND now_tz < u_trial_ends THEN
        RETURN TRUE;
    END IF;

    -- Verificação de assinatura ativa ou cancelada porém dentro do prazo pago
    IF u_sub_status = 'active' THEN
        IF u_sub_ends IS NULL OR now_tz < u_sub_ends THEN
            RETURN TRUE;
        END IF;
    END IF;

    IF u_sub_status = 'canceled' AND u_sub_ends IS NOT NULL AND now_tz < u_sub_ends THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.enforce_medications_limit()
RETURNS TRIGGER AS $$
DECLARE
    med_count INTEGER;
    is_premium BOOLEAN;
BEGIN
    is_premium := public.has_premium_access(NEW.user_id);
    
    IF NOT is_premium THEN
        SELECT COUNT(*) INTO med_count
        FROM public.medications
        WHERE user_id = NEW.user_id;
        
        IF med_count >= 3 THEN
            RAISE EXCEPTION 'Limite do Plano Gratuito atingido: Você já cadastrou os 3 medicamentos disponíveis.'
                USING ERRCODE = 'P9999';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.enforce_appointments_limit()
RETURNS TRIGGER AS $$
DECLARE
    app_count INTEGER;
    is_premium BOOLEAN;
BEGIN
    is_premium := public.has_premium_access(NEW.user_id);
    
    IF NOT is_premium THEN
        SELECT COUNT(*) INTO app_count
        FROM public.appointments
        WHERE user_id = NEW.user_id;
        
        IF app_count >= 5 THEN
            RAISE EXCEPTION 'Limite do Plano Gratuito atingido: Você já cadastrou os 5 compromissos disponíveis.'
                USING ERRCODE = 'P9998';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_enforce_medications_limit ON public.medications;
CREATE TRIGGER trigger_enforce_medications_limit
    BEFORE INSERT ON public.medications
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_medications_limit();

DROP TRIGGER IF EXISTS trigger_enforce_appointments_limit ON public.appointments;
CREATE TRIGGER trigger_enforce_appointments_limit
    BEFORE INSERT ON public.appointments
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_appointments_limit();
