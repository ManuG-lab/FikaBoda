import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { MapPin, Search, X } from 'lucide-react';
import type { LatLng } from '../../types/fikaboda';
import { WESTLANDS_CENTER } from '../../utils/pricing';

export const WESTLANDS_LANDMARKS: Array<{ label: string; address: string; coords: LatLng }> = [
  {
    label: 'Sarit Centre, Westlands',
    address: 'Sarit Centre, Karuna Rd, Westlands, Nairobi',
    coords: { lat: -1.2611, lng: 36.8019 },
  },
  {
    label: 'Westgate Mall',
    address: 'Westgate Shopping Mall, Mwanzi Rd, Westlands, Nairobi',
    coords: { lat: -1.2571, lng: 36.8034 },
  },
  {
    label: 'The Oval, Ring Rd Westlands',
    address: 'The Oval, Ring Rd Parklands, Westlands, Nairobi',
    coords: { lat: -1.2647, lng: 36.8037 },
  },
  {
    label: 'Yaya Centre, Kilimani',
    address: 'Yaya Centre, Argwings Kodhek Rd, Kilimani, Nairobi',
    coords: { lat: -1.2929, lng: 36.7885 },
  },
  {
    label: 'Lavington Mall',
    address: 'Lavington Mall, James Gichuru Rd, Lavington, Nairobi',
    coords: { lat: -1.2794, lng: 36.7712 },
  },
  {
    label: 'Diamond Plaza, Parklands',
    address: 'Diamond Plaza II, Masari Rd, Parklands, Nairobi',
    coords: { lat: -1.2623, lng: 36.8178 },
  },
];

interface PlacesAddressInputProps {
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  hasMapsKey: boolean;
  onChangeText: (text: string) => void;
  onSelectPlace: (result: { address: string; location: LatLng }) => void;
}

function checkQuotaError(err: unknown): boolean {
  const msg = String(err || '');
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('429') ||
    msg.includes('QuotaExceededError')
  );
}

export const PlacesAddressInput: React.FC<PlacesAddressInputProps> = ({
  label,
  value,
  placeholder = 'Search Nairobi street, building or estate...',
  required = false,
  hasMapsKey,
  onChangeText,
  onSelectPlace,
}) => {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef = useRef<any>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hasMapsKey || !placesLib || !focused) return;
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      return;
    }

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoading(true);
        setApiError(null);
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib as any;
        if (!AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
          setLoading(false);
          return;
        }
        if (!sessionTokenRef.current && AutocompleteSessionToken) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        const request = {
          input: trimmed,
          sessionToken: sessionTokenRef.current || undefined,
          includedRegionCodes: ['ke'],
          locationBias: {
            center: WESTLANDS_CENTER,
            radius: 22000,
          },
        };
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        setSuggestions(res?.suggestions || []);
      } catch (err) {
        if (checkQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          setApiError('Places quota reached — select a Westlands landmark or pin directly on the map.');
        } else {
          setApiError('Places suggestions unavailable — pick a landmark or click the map.');
        }
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value, hasMapsKey, placesLib, focused]);

  const handleSelectSuggestion = async (suggestion: any) => {
    if (!suggestion?.placePrediction) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });
      const loc = place.location;
      const lat = typeof loc?.lat === 'function' ? loc.lat() : loc?.lat;
      const lng = typeof loc?.lng === 'function' ? loc.lng() : loc?.lng;
      const resolvedAddress =
        place.formattedAddress ||
        place.displayName ||
        suggestion.placePrediction.text?.text ||
        value;

      if (typeof lat === 'number' && typeof lng === 'number') {
        onChangeText(resolvedAddress);
        onSelectPlace({ address: resolvedAddress, location: { lat, lng } });
      }
      sessionTokenRef.current = null;
      setSuggestions([]);
      setFocused(false);
    } catch (err) {
      if (checkQuotaError(err)) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      setApiError('Could not retrieve place coordinates. Click directly on the map instead.');
    }
  };

  return (
    <div className="relative space-y-1.5">
      <label className="block text-xs font-semibold text-[#17231F]">{label}</label>
      <div className="relative">
        <Search className="w-4 h-4 text-[#77827B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          required={required}
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 220)}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2.5 text-sm bg-white border border-[#E3E7E2] rounded-lg focus:outline-none focus:border-[#123C32] text-[#17231F]"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChangeText('');
              setSuggestions([]);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#77827B] hover:text-[#17231F] p-1 cursor-pointer"
            aria-label="Clear address"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {apiError && <p className="text-[11px] text-amber-800">{apiError}</p>}

      {focused && (suggestions.length > 0 || loading) && (
        <div className="absolute left-0 right-0 z-40 mt-1 bg-white border border-[#E3E7E2] rounded-xl shadow-lg overflow-hidden">
          {loading && (
            <div className="px-3.5 py-2 text-xs text-[#77827B]">Searching Nairobi addresses...</div>
          )}
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                void handleSelectSuggestion(s);
              }}
              className="w-full text-left px-3.5 py-2.5 text-xs hover:bg-[#F7F8F5] flex items-start gap-2.5 border-b last:border-b-0 border-[#E3E7E2] cursor-pointer"
            >
              <MapPin className="w-3.5 h-3.5 text-[#123C32] mt-0.5 shrink-0" />
              <span className="text-[#17231F] leading-snug">
                {s.placePrediction?.text?.text || 'Selected Location'}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Quick Westlands hubs for fast dispatch & fallback */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
        <span className="text-[11px] text-[#77827B]">Quick hubs:</span>
        {WESTLANDS_LANDMARKS.slice(0, 4).map((hub) => (
          <button
            key={hub.label}
            type="button"
            onClick={() => {
              onChangeText(hub.address);
              onSelectPlace({ address: hub.address, location: hub.coords });
            }}
            className="text-[11px] font-medium text-[#123C32] hover:underline cursor-pointer"
          >
            {hub.label.split(',')[0]}
          </button>
        ))}
      </div>
    </div>
  );
};
