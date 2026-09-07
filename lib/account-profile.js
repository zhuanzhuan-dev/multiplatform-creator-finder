export function accountProfile(value, userId) {
  if (typeof userId !== 'string' || !userId || !value || value.id !== userId) return null;
  return { id: userId, name: String(value.name || '').slice(0, 120), email: String(value.email || '').slice(0, 254) };
}
