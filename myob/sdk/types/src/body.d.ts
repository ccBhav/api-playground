/**
 * Parse a response body as JSON, falling back to the raw text (MYOB sometimes sends HTML or plain text).
 * @param {string} text
 * @returns {any}
 */
export function parseBody(text: string): any;
