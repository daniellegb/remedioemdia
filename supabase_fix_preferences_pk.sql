-- SCRIPT PARA CORRIGIR A CHAVE PRIMÁRIA DA TABELA user_preferences
-- Isso torna o user_id a chave primária, o que é ideal para tabelas de "um registro por usuário"
-- e resolve problemas de conflito em operações de upsert.

DO $$ 
BEGIN
    -- 1. Remover a restrição de chave primária atual (que usa a coluna 'id')
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_pkey') THEN
        ALTER TABLE public.user_preferences DROP CONSTRAINT user_preferences_pkey;
    END IF;

    -- 2. Adicionar a nova chave primária na coluna 'user_id'
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_pkey') THEN
        ALTER TABLE public.user_preferences ADD PRIMARY KEY (user_id);
    END IF;

    -- 3. Remover a restrição UNIQUE redundante se ela existir (já que PK é única por definição)
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_user_id_key') THEN
        ALTER TABLE public.user_preferences DROP CONSTRAINT user_preferences_user_id_key;
    END IF;

    -- 4. Opcional: Remover a coluna 'id' se ela não for mais necessária
    -- IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_preferences' AND column_name='id') THEN
    --     ALTER TABLE public.user_preferences DROP COLUMN id;
    -- END IF;

END $$;

-- Forçar reload do cache do PostgREST
NOTIFY pgrst, 'reload schema';
