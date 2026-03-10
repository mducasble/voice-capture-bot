import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * ISO 3166-1 alpha-2 codes for countries we support.
 * Sorted alphabetically by localized name at render time.
 */
const COUNTRY_CODES = [
  "AO", "AR", "AT", "AU", "BD", "BE", "BO", "BR", "CA", "CH", "CL", "CN",
  "CO", "CR", "CU", "CZ", "DE", "DK", "DO", "DZ", "EC", "EG", "ES", "ET",
  "FI", "FJ", "FR", "GB", "GH", "GR", "GT", "HK", "HN", "HT", "HU", "ID",
  "IE", "IL", "IN", "IR", "IT", "JM", "JP", "KE", "KR", "LK", "MA", "MM",
  "MX", "MY", "MZ", "NG", "NI", "NL", "NO", "NZ", "PA", "PE", "PH", "PK",
  "PL", "PR", "PT", "PY", "RO", "RU", "SA", "SE", "SG", "TH", "TN", "TR",
  "TW", "TZ", "UA", "US", "UY", "VE", "VN", "ZA",
];

interface CountrySelectProps {
  value: string;
  onValueChange: (code: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

export default function CountrySelect({ value, onValueChange, placeholder, required, className }: CountrySelectProps) {
  const { i18n } = useTranslation();

  const countries = useMemo(() => {
    let dn: Intl.DisplayNames | null = null;
    try {
      dn = new Intl.DisplayNames([i18n.language || "en"], { type: "region" });
    } catch { /* fallback to codes */ }

    const list = COUNTRY_CODES.map(code => ({
      code,
      name: dn?.of(code) || code,
    }));

    // Sort with BR first, then alphabetically by name
    list.sort((a, b) => {
      if (a.code === "BR") return -1;
      if (b.code === "BR") return 1;
      return a.name.localeCompare(b.name, i18n.language);
    });

    return list;
  }, [i18n.language]);

  return (
    <Select value={value || undefined} onValueChange={onValueChange} required={required}>
      <SelectTrigger className={`portal-brutalist-input ${className || ""}`}>
        <SelectValue placeholder={placeholder || "—"} />
      </SelectTrigger>
      <SelectContent>
        {countries.map(c => (
          <SelectItem key={c.code} value={c.code}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
