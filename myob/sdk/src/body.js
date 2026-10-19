/**
 * Parse a response body as JSON, falling back to the raw text (MYOB sometimes sends HTML or plain text).
 * @param {string} text
 * @returns {any}
 */
const parseBody = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

module.exports = { parseBody };
