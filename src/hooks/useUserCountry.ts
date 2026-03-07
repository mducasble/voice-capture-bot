import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

/**
 * Timezone → ISO 3166-1 alpha-2 country code mapping.
 * Covers the most common timezones; falls back to null.
 */
const TZ_TO_COUNTRY: Record<string, string> = {
  // Americas
  "America/Sao_Paulo": "BR", "America/Fortaleza": "BR", "America/Recife": "BR",
  "America/Bahia": "BR", "America/Belem": "BR", "America/Manaus": "BR",
  "America/Cuiaba": "BR", "America/Campo_Grande": "BR", "America/Porto_Velho": "BR",
  "America/Rio_Branco": "BR", "America/Noronha": "BR", "America/Araguaina": "BR",
  "America/Maceio": "BR", "America/Santarem": "BR", "America/Boa_Vista": "BR",
  "America/Eirunepe": "BR",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US",
  "America/Los_Angeles": "US", "America/Anchorage": "US", "Pacific/Honolulu": "US",
  "America/Phoenix": "US", "America/Detroit": "US", "America/Indiana/Indianapolis": "US",
  "America/Boise": "US",
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA",
  "America/Winnipeg": "CA", "America/Halifax": "CA", "America/St_Johns": "CA",
  "America/Mexico_City": "MX", "America/Cancun": "MX", "America/Monterrey": "MX",
  "America/Tijuana": "MX",
  "America/Argentina/Buenos_Aires": "AR", "America/Argentina/Cordoba": "AR",
  "America/Bogota": "CO", "America/Lima": "PE", "America/Santiago": "CL",
  "America/Caracas": "VE", "America/Guayaquil": "EC", "America/La_Paz": "BO",
  "America/Asuncion": "PY", "America/Montevideo": "UY",
  "America/Panama": "PA", "America/Guatemala": "GT", "America/Tegucigalpa": "HN",
  "America/Managua": "NI", "America/San_Jose": "CR", "America/Havana": "CU",
  "America/Santo_Domingo": "DO", "America/Port-au-Prince": "HT",
  "America/Jamaica": "JM", "America/Puerto_Rico": "PR",

  // Europe
  "Europe/London": "GB", "Europe/Paris": "FR", "Europe/Berlin": "DE",
  "Europe/Madrid": "ES", "Europe/Rome": "IT", "Europe/Lisbon": "PT",
  "Europe/Amsterdam": "NL", "Europe/Brussels": "BE", "Europe/Zurich": "CH",
  "Europe/Vienna": "AT", "Europe/Stockholm": "SE", "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI", "Europe/Warsaw": "PL",
  "Europe/Prague": "CZ", "Europe/Budapest": "HU", "Europe/Bucharest": "RO",
  "Europe/Athens": "GR", "Europe/Istanbul": "TR", "Europe/Moscow": "RU",
  "Europe/Kiev": "UA", "Europe/Dublin": "IE",

  // Asia
  "Asia/Tokyo": "JP", "Asia/Shanghai": "CN", "Asia/Hong_Kong": "HK",
  "Asia/Seoul": "KR", "Asia/Kolkata": "IN", "Asia/Calcutta": "IN",
  "Asia/Singapore": "SG", "Asia/Bangkok": "TH", "Asia/Jakarta": "ID",
  "Asia/Manila": "PH", "Asia/Ho_Chi_Minh": "VN", "Asia/Kuala_Lumpur": "MY",
  "Asia/Taipei": "TW", "Asia/Dubai": "AE", "Asia/Riyadh": "SA",
  "Asia/Tehran": "IR", "Asia/Karachi": "PK", "Asia/Dhaka": "BD",
  "Asia/Colombo": "LK", "Asia/Yangon": "MM",

  // Africa
  "Africa/Cairo": "EG", "Africa/Lagos": "NG", "Africa/Johannesburg": "ZA",
  "Africa/Nairobi": "KE", "Africa/Casablanca": "MA", "Africa/Algiers": "DZ",
  "Africa/Accra": "GH", "Africa/Dar_es_Salaam": "TZ", "Africa/Addis_Ababa": "ET",
  "Africa/Tunis": "TN", "Africa/Luanda": "AO", "Africa/Maputo": "MZ",

  // Oceania
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Brisbane": "AU",
  "Australia/Perth": "AU", "Australia/Adelaide": "AU",
  "Pacific/Auckland": "NZ", "Pacific/Fiji": "FJ",
};

function detectCountryFromTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TZ_TO_COUNTRY[tz] || null;
  } catch {
    return null;
  }
}

/**
 * Returns the user's country code:
 * - If logged in and profile has `country`, use that.
 * - Otherwise, infer from browser timezone.
 */
export function useUserCountry() {
  const { user } = useAuth();

  const { data: profileCountry } = useQuery({
    queryKey: ["profile-country", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("country")
        .eq("id", user!.id)
        .single();
      return (data as any)?.country as string | null;
    },
    enabled: !!user?.id,
  });

  const browserCountry = detectCountryFromTimezone();

  // Profile country takes priority if user is logged in and has set it
  const country = profileCountry || browserCountry;

  return { country, browserCountry, profileCountry };
}

/**
 * Detect country without auth (for public pages like /auth).
 */
export function detectBrowserCountry(): string | null {
  return detectCountryFromTimezone();
}

/**
 * Common country name → ISO code mapping for resolving free-text country values.
 */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "brasil": "BR", "brazil": "BR",
  "argentina": "AR",
  "colombia": "CO",
  "peru": "PE",
  "chile": "CL",
  "venezuela": "VE",
  "mexico": "MX", "méxico": "MX",
  "estados unidos": "US", "united states": "US", "usa": "US",
  "canada": "CA", "canadá": "CA",
  "portugal": "PT",
  "espanha": "ES", "españa": "ES", "spain": "ES",
  "uruguai": "UY", "uruguay": "UY",
  "paraguai": "PY", "paraguay": "PY",
  "bolivia": "BO", "bolívia": "BO",
  "equador": "EC", "ecuador": "EC",
  "panamá": "PA", "panama": "PA",
};

/**
 * Normalize a country value (which could be a name or a code) to ISO code.
 */
function normalizeCountry(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return COUNTRY_NAME_TO_CODE[trimmed.toLowerCase()] || null;
}

/**
 * Check if a campaign is visible for a given country, based on its geographic scope.
 * - No scope → visible to everyone
 * - restriction_mode "include" → visible only if country is in the list
 * - restriction_mode "exclude" → visible unless country is in the list
 * - If user country is unknown (null) → show campaign (don't block)
 */
export function isCampaignVisibleForCountry(
  geoScope: { restriction_mode?: string | null; countries?: string[] | null } | null | undefined,
  userCountry: string | null
): boolean {
  if (!geoScope) return true;
  const normalizedUser = normalizeCountry(userCountry);
  if (!normalizedUser) return true; // can't determine → show
  if (!geoScope.countries || geoScope.countries.length === 0) return true;

  const mode = geoScope.restriction_mode || "include";
  const countries = geoScope.countries.map(c => c.toUpperCase());

  if (mode === "include") return countries.includes(normalizedUser);
  if (mode === "exclude") return !countries.includes(normalizedUser);
  return true;
}
