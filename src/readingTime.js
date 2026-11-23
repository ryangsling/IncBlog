function readingMinutes(content) {
  const words = (content || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

module.exports = { readingMinutes };
