// IncBlog post editor: CodeMirror 6, live preview, word count and AI tools.
import { EditorView, basicSetup } from 'https://esm.sh/codemirror@6.0.1';
import { markdown } from 'https://esm.sh/@codemirror/lang-markdown@6.2.5';
import { oneDark } from 'https://esm.sh/@codemirror/theme-one-dark@6.1.2';

const contentField = document.getElementById('content');
const editorHost = document.getElementById('editor');
const previewEl = document.getElementById('preview');
const previewToggle = document.getElementById('preview-toggle');
const wordCountEl = document.getElementById('word-count');
const titleInput = document.getElementById('title');
const aiError = document.getElementById('ai-error');

function updateCounts() {
  const words = contentField.value.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  wordCountEl.textContent = `${words} words \u00b7 ${minutes} min read`;
}

const view = new EditorView({
  doc: contentField.value,
  extensions: [
    basicSetup,
    markdown(),
    oneDark,
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        contentField.value = update.state.doc.toString();
        updateCounts();
      }
    }),
  ],
  parent: editorHost,
});
updateCounts();

// Preview toggle
let previewing = false;
previewToggle.addEventListener('click', () => {
  previewing = !previewing;
  if (previewing) {
    previewEl.innerHTML = window.marked.parse(contentField.value || '');
    previewEl.hidden = false;
    editorHost.style.display = 'none';
    previewToggle.textContent = 'Edit';
  } else {
    previewEl.hidden = true;
    editorHost.style.display = '';
    previewToggle.textContent = 'Preview';
  }
});

// Scheduled status: show/hide the datetime picker
const statusSelect = document.getElementById('status');
const scheduleField = document.getElementById('schedule-field');
function syncSchedule() {
  scheduleField.hidden = statusSelect.value !== 'scheduled';
}
statusSelect.addEventListener('change', syncSchedule);
syncSchedule();

// AI helpers
function showError(message) {
  aiError.textContent = message;
  aiError.hidden = false;
  setTimeout(() => { aiError.hidden = true; }, 6000);
}

async function callAi(endpoint, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Thinking\u2026';
  try {
    const res = await fetch(`/api/ai/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ title: titleInput.value, content: contentField.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI request failed');
    return data;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

document.getElementById('ai-excerpt').addEventListener('click', async (e) => {
  try {
    const data = await callAi('excerpt', e.target);
    document.getElementById('excerpt').value = data.excerpt;
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById('ai-summary').addEventListener('click', async (e) => {
  try {
    const data = await callAi('summary', e.target);
    document.getElementById('summary').value = data.summary;
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById('ai-titles').addEventListener('click', async (e) => {
  try {
    const data = await callAi('titles', e.target);
    const box = document.getElementById('title-suggestions');
    box.innerHTML = '';
    data.titles.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = t;
      btn.addEventListener('click', () => {
        titleInput.value = t;
        box.innerHTML = '';
      });
      box.appendChild(btn);
    });
  } catch (err) {
    showError(err.message);
  }
});

// Make sure the hidden textarea is synced before submit
document.getElementById('post-form').addEventListener('submit', () => {
  contentField.value = view.state.doc.toString();
});
