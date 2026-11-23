const socialFields = ['twitter', 'github', 'linkedin'];
const embedFields = [...socialFields, 'gaId'];

function socialUrl(value) {
  if (!/^https:\/\//i.test(value) || /[\\\x00-\x20\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password || url.href.length > 255 ? null : url.href;
  } catch {
    return null;
  }
}

function validatedEmbed(field, value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return '';
  if (field === 'gaId') return /^G-[A-Z0-9]{6,20}$/.test(text) ? text : null;
  return socialUrl(text);
}

function publicSettingsFields(settings) {
  return {
    ...settings,
    ...Object.fromEntries(embedFields.map((field) => [field, validatedEmbed(field, settings[field]) || ''])),
  };
}

module.exports = { embedFields, publicSettingsFields, validatedEmbed };
