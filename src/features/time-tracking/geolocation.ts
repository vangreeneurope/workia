/**
 * Ubicación PUNTUAL al fichar: una sola lectura, nunca seguimiento
 * (getCurrentPosition, no watchPosition). Solo se llama si la política lo pide
 * y después de mostrar el aviso de uso.
 */

export type LocationStatus = "not_requested" | "granted" | "denied" | "unavailable" | "timeout";

export type LocationReading = {
  status: LocationStatus;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
};

/** Códigos de GeolocationPositionError: 1 permiso, 2 no disponible, 3 tiempo. */
export function statusFromError(code: number): LocationStatus {
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

/** Redondea a 6 decimales (unos 10 cm) y la precisión a metros enteros. */
export function toReading(coords: {
  latitude: number;
  longitude: number;
  accuracy: number;
}): LocationReading {
  return {
    status: "granted",
    latitude: Math.round(coords.latitude * 1e6) / 1e6,
    longitude: Math.round(coords.longitude * 1e6) / 1e6,
    accuracy: Math.min(100000, Math.max(0, Math.round(coords.accuracy))),
  };
}

export function readLocationOnce(timeoutMs = 10000): Promise<LocationReading> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return Promise.resolve({ status: "unavailable" });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(toReading(position.coords)),
      (error) => resolve({ status: statusFromError(error.code) }),
      { enableHighAccuracy: false, maximumAge: 0, timeout: timeoutMs },
    );
  });
}
