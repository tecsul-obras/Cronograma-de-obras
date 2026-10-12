import {createClient} from 'npm:@supabase/supabase-js@2';
import {handler} from './core.mjs';

// verify_jwt=false permite al cron llegar sin una sesión de usuario.
// El handler SIEMPRE valida getUser() + radar_access() para solicitudes de usuarios,
// o el secreto propio para cron. La función no tiene una ruta pública de escritura.
const env={
 SUPABASE_URL:Deno.env.get('SUPABASE_URL')!,
 SUPABASE_ANON_KEY:Deno.env.get('SUPABASE_ANON_KEY')!,
 SUPABASE_SERVICE_ROLE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
 RADAR_ALLOWED_ORIGIN:Deno.env.get('RADAR_ALLOWED_ORIGIN'),
 RADAR_CRON_SECRET:Deno.env.get('RADAR_CRON_SECRET')
};
Deno.serve(handler(createClient,env));
