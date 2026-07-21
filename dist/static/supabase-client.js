// Public frontend configuration only. Never add service_role or secret keys here.
window.VENUS_SUPABASE_CONFIG = Object.freeze({
  SUPABASE_URL: 'https://sunkovtufoifsvfmqwas.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_NQdtCvo-UhhNl1-3jSL1tQ_j7gJYMbK'
});

window.createVenusSupabaseClient = function createVenusSupabaseClient() {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = window.VENUS_SUPABASE_CONFIG;
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
};
