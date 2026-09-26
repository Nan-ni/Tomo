// =====================================================================
//  Tomo · configuración
//  Pega aquí los dos datos de tu proyecto de Supabase
//  (Supabase → tu proyecto → Project Settings → API / API Keys).
//  Ambos son públicos por diseño: la seguridad la ponen las reglas de la base de datos.
//  NO pegues aquí la "service_role" / "secret" key ni tu clave de Google.
// =====================================================================
window.TOMO_CONFIG = {
  supabaseUrl: "https://gfarwiasxwamaiozbkgo.supabase.co",
  supabaseKey: "sb_publishable_-ASYisBOureFSK0VaijquQ_PB8ew1GY",     // la "anon public" o la "publishable" (empieza con eyJ… o sb_publishable_…)
  dominioId: "tomo.invalid"            // no lo cambies (debe coincidir con la función "aprobar")
};
