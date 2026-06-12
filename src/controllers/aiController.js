const Anthropic = require('@anthropic-ai/sdk');

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest';

async function complete(prompt, maxTokens = 500) {
  const c = getClient();
  if (!c) {
    const err = new Error('AI features are not configured. Set ANTHROPIC_API_KEY in your .env file.');
    err.status = 503;
    throw err;
  }
  const msg = await c.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg.content
    .map((block) => block.text || '')
    .join('')
    .trim();
}

function requireContent(req, res) {
  const content = (req.body.content || '').trim();
  if (!content) {
    res.status(400).json({ error: 'Write some post content first.' });
    return null;
  }
  return content.slice(0, 12000);
}

exports.excerpt = async (req, res) => {
  const content = requireContent(req, res);
  if (!content) return;
  try {
    const text = await complete(
      `Write a hook-style excerpt of 30-50 words for the following blog post titled "${req.body.title || 'Untitled'}". It should make readers want to click. Respond with the excerpt text only - no quotes, no preamble.\n\nPOST CONTENT:\n${content}`
    );
    res.json({ excerpt: text });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

exports.summary = async (req, res) => {
  const content = requireContent(req, res);
  if (!content) return;
  try {
    const text = await complete(
      `Write a 100-150 word summary of the following blog post titled "${req.body.title || 'Untitled'}". Respond with the summary text only - no quotes, no preamble.\n\nPOST CONTENT:\n${content}`
    );
    res.json({ summary: text });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

exports.titles = async (req, res) => {
  const content = requireContent(req, res);
  if (!content) return;
  try {
    const text = await complete(
      `Suggest 3 alternative, compelling titles for the following blog post (current title: "${req.body.title || 'Untitled'}"). Respond with exactly 3 titles, one per line, with no numbering, bullets or extra text.\n\nPOST CONTENT:\n${content}`
    );
    const titles = text
      .split('\n')
      .map((l) => l.replace(/^[\s\d.\-*\u2022)]+/, '').trim())
      .filter(Boolean)
      .slice(0, 3);
    res.json({ titles });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
