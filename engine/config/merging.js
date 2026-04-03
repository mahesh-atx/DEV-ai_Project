function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    const next = {};
    for (const [key, nested] of Object.entries(value)) {
      next[key] = cloneValue(nested);
    }
    return next;
  }
  return value;
}

export function deepMergeObjects(target = {}, source = {}) {
  const output = isPlainObject(target) ? { ...target } : {};

  for (const [key, value] of Object.entries(source || {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMergeObjects(output[key], value);
      continue;
    }

    output[key] = cloneValue(value);
  }

  return output;
}
