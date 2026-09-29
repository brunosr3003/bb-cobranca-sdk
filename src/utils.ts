/** Formats a date the way the Cobranças API expects it: `dd.mm.aaaa`. */
export function formatBBDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}`;
}

/**
 * Builds the 20-digit `numeroTituloCliente`: "000" + the 7-digit agreement
 * number + a 10-digit sequence chosen by you (unique per agreement).
 */
export function buildNumeroTituloCliente(numeroConvenio: string | number, sequence: string | number): string {
  const convenio = String(numeroConvenio);
  const seq = String(sequence);
  if (!/^\d{1,7}$/.test(convenio)) {
    throw new RangeError(`numeroConvenio must have at most 7 digits, got "${convenio}"`);
  }
  if (!/^\d{1,10}$/.test(seq)) {
    throw new RangeError(`sequence must have at most 10 digits, got "${seq}"`);
  }
  return `000${convenio.padStart(7, "0")}${seq.padStart(10, "0")}`;
}
