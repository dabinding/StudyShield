export function isAllowed(category, allowUncertain = false) {
  return category === 'educational' || (category === 'uncertain' && allowUncertain);
}
