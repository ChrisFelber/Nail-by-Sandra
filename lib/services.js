// Canonical service catalog — the ONLY source of truth for prices.
// Keep this in sync with the `services` array in index.html's booking UI.
// The server derives price from this list by service name; it never
// trusts a price sent by the browser.

export const SERVICES = [
  { name: 'Manucure H/F sans VSP', price: 25, from: false },
  { name: 'Pose complète chablon', price: 85, from: true },
  { name: 'Pose complète capsule', price: 70, from: true },
  { name: 'Remplissage', price: 65, from: true },
  { name: 'Gainage', price: 50, from: true },
  { name: 'Pose VSP simple', price: 45, from: false },
  { name: 'Pédicure H/F sans VSP', price: 25, from: false },
  { name: 'Vernis semi-permanent pieds', price: 60, from: false },
];

const BY_NAME = new Map(SERVICES.map(s => [s.name, s]));

/** Looks up a service by exact name. Returns undefined if unknown. */
export function findService(name) {
  return BY_NAME.get(String(name || '').trim());
}

/** Formats a service's price the same way the frontend does, e.g. "Dès 85 CHF". */
export function formatPrice(service) {
  if (!service) return '';
  return `${service.from ? 'Dès ' : ''}${service.price} CHF`;
}
