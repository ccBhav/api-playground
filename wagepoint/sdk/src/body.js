/** Parse a response body as JSON, falling back to the raw text (e.g. an HTML error page from a proxy). */
const parseBody = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

module.exports = { parseBody };
