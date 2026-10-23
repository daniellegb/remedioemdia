-- Atualiza a foreign key de user_id na tabela stripe_events para ON DELETE SET NULL
-- Isso permite que um usuário seja excluído de auth.users sem violar chave estrangeira,
-- preservando os registros de auditoria financeira com user_id = NULL.

DO $$
DECLARE
    fk_record RECORD;
BEGIN
    FOR fk_record IN (
        SELECT tc.constraint_name 
        FROM information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' 
          AND tc.table_schema = 'public'
          AND tc.table_name = 'stripe_events'
          AND kcu.column_name = 'user_id'
    ) LOOP
        EXECUTE 'ALTER TABLE public.stripe_events DROP CONSTRAINT IF EXISTS ' || quote_ident(fk_record.constraint_name);
    END LOOP;
END $$;

ALTER TABLE public.stripe_events
ADD CONSTRAINT stripe_events_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
