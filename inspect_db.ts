import postgres from 'postgres';

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('SUPABASE_DB_URL environment variable is missing.');
    process.exit(1);
  }

  console.log('Connecting to PostgreSQL database...');
  const sql = postgres(dbUrl, { ssl: 'require' });

  try {
    console.log('\n========================================');
    console.log('1. TABLE SCHEMA & COLUMNS (medications)');
    console.log('========================================');
    const columns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'medications'
      ORDER BY ordinal_position;
    `;
    console.table(columns);

    console.log('\n========================================');
    console.log('2. TRIGGERS ON medications TABLE');
    console.log('========================================');
    const triggers = await sql`
      SELECT 
          tgname as trigger_name,
          proname as function_name,
          CASE tgtype::integer::bit(7) & B'0000010'::bit(7) WHEN B'0000010'::bit(7) THEN 'BEFORE' ELSE 'AFTER' END as timing,
          CASE tgtype::integer::bit(7) & B'0000100'::bit(7) WHEN B'0000100'::bit(7) THEN 'ROW' ELSE 'STATEMENT' END as level,
          array_to_string(array[
            CASE tgtype::integer::bit(7) & B'0001000'::bit(7) WHEN B'0001000'::bit(7) THEN 'INSERT' END,
            CASE tgtype::integer::bit(7) & B'0010000'::bit(7) WHEN B'0010000'::bit(7) THEN 'DELETE' END,
            CASE tgtype::integer::bit(7) & B'0100000'::bit(7) WHEN B'0100000'::bit(7) THEN 'UPDATE' END,
            CASE tgtype::integer::bit(7) & B'1000000'::bit(7) WHEN B'1000000'::bit(7) THEN 'TRUNCATE' END
          ], ' OR ') as events
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_proc p ON t.tgfoid = p.oid
      WHERE n.nspname = 'public' AND c.relname = 'medications' AND tgisinternal = false;
    `;
    console.table(triggers);

    console.log('\n========================================');
    console.log('3. TRIGGERS ON RELATED TABLES (consumption_records, appointments, user_preferences)');
    console.log('========================================');
    const otherTriggers = await sql`
      SELECT 
          c.relname as table_name,
          tgname as trigger_name,
          proname as function_name
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_proc p ON t.tgfoid = p.oid
      WHERE n.nspname = 'public' 
        AND c.relname IN ('consumption_records', 'appointments', 'user_preferences', 'profiles', 'notification_queue') 
        AND tgisinternal = false;
    `;
    console.table(otherTriggers);

    console.log('\n========================================');
    console.log('4. SOURCE OF LIMIT/TRIGGER FUNCTIONS ON medications');
    console.log('========================================');
    const functions = await sql`
      SELECT proname as name, prosrc as definition
      FROM pg_proc
      WHERE proname IN ('enforce_medications_limit', 'has_premium_access');
    `;
    for (const fn of functions) {
      console.log(`--- FUNCTION: ${fn.name} ---`);
      console.log(fn.definition);
      console.log('--------------------------------\n');
    }

    console.log('\n========================================');
    console.log('5. RLS POLICIES ON medications TABLE');
    console.log('========================================');
    const policies = await sql`
      SELECT policyname, cmd, roles, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'medications';
    `;
    console.table(policies);

    console.log('\n========================================');
    console.log('6. FOREIGN KEYS AND REFERENTIAL CONSTRAINTS');
    console.log('========================================');
    const fks = await sql`
      SELECT
          tc.constraint_name, 
          tc.table_name, 
          kcu.column_name, 
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name 
      FROM 
          information_schema.table_constraints AS tc 
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' 
        AND (tc.table_name = 'medications' OR ccu.table_name = 'medications');
    `;
    console.table(fks);

    console.log('\n========================================');
    console.log('7. SYSTEM LOCKS AND BLOCKED SESSSIONS');
    console.log('========================================');
    const locks = await sql`
      SELECT
        blocked_locks.pid     AS blocked_pid,
        blocked_activity.usename  AS blocked_user,
        blocking_locks.pid    AS blocking_pid,
        blocking_activity.usename AS blocking_user,
        blocked_activity.query    AS blocked_statement,
        blocking_activity.query   AS blocking_statement
      FROM  pg_catalog.pg_locks         blocked_locks
      JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
      JOIN pg_catalog.pg_locks         blocking_locks 
          ON blocking_locks.locktype = blocked_locks.locktype
          AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
          AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
          AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
          AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
          AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
          AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
          AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
          AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
          AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
          AND blocking_locks.pid != blocked_locks.pid
      JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
      WHERE NOT blocked_locks.granted;
    `;
    if (locks.length === 0) {
      console.log('No blocked sessions (locks) detected.');
    } else {
      console.table(locks);
    }

    console.log('\n========================================');
    console.log('8. ACTIVE RUNNING TRANSACTIONS / QUERIES');
    console.log('========================================');
    const activeQueries = await sql`
      SELECT pid, age(clock_timestamp(), query_start) as duration, state, query 
      FROM pg_stat_activity 
      WHERE state != 'idle' AND query NOT LIKE '%pg_stat_activity%';
    `;
    console.table(activeQueries);

  } catch (err: any) {
    console.error('Error running database inspection:', err.message || err);
  } finally {
    await sql.end();
  }
}

main();
