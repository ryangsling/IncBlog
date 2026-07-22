// In-process client test: boots the real app, loads the editor page into jsdom,
// executes editor.js, and exercises WYSIWYG mode.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const supertest = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const PROJ = __dirname;
process.env.NODE_ENV = 'test';
process.env.DATABASE_FILE = path.join(require('os').tmpdir(), 'incblog_editor_test_' + Date.now() + '.db');
if (fs.existsSync(process.env.DATABASE_FILE)) fs.unlinkSync(process.env.DATABASE_FILE);

const { initDb, Category, Post, User } = require(path.join(PROJ, 'src', 'models'));
const bcrypt = require('bcryptjs');
const dashboard = require(path.join(PROJ, 'src', 'routes', 'dashboard'));
const posts = require(path.join(PROJ, 'src', 'routes', 'posts'));
const auth = require(path.join(PROJ, 'src', 'routes', 'auth'));
const { requireAuth, attachUser, signToken } = require(path.join(PROJ, 'src', 'middleware', 'auth'));

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(PROJ, 'src', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({ secret: 'test', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax' } }));
app.use(require(path.join(PROJ, 'src', 'middleware', 'passport')).initialize());
app.use(attachUser);
app.use('/', auth);
app.use('/dashboard/posts', requireAuth, posts);
app.get('/dashboard/posts/new', requireAuth, (req, res) => {
  Category.findAll().then((categories) => {
    res.render('dashboard/post-form', {
      title: 'New post', post: null, categories,
      tagsString: '', format: 'html', user: req.user,
    });
  });
});
app.use('/dashboard', requireAuth, dashboard);

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ok  -', name); } else { fail++; console.log('  FAIL-', name); } }

(async () => {
  await initDb();
  const agent = supertest(app);
  const ts = Date.now();
  const username = 'ed' + ts;
  const email = `${username}@t.com`;
  const testUser = await User.create({ name: 'Ed', email, passwordHash: bcrypt.hashSync('test1234', 10), username, emailVerified: true });
  const cookie = 'token=' + signToken(testUser);

  let r = await agent.get('/dashboard/posts/new').set('Cookie', cookie);
  if (r.status !== 200) { console.error('page load failed', r.status); process.exit(1); }

  const dom = new JSDOM(r.text.replace(/<script[\s\S]*?<\/script>/g, ''), { runScripts: 'dangerously', url: 'http://localhost/' });
  const { window } = dom;
  const { document } = window;

  window.document.execCommand = function (cmd, _a, val) {
    window.__lastCmd = cmd;
    const host = document.getElementById('editor-host');
    if (cmd === 'insertHTML' && host) { host.insertAdjacentHTML('beforeend', val); return true; }
    if (cmd === 'insertHorizontalRule' && host) { host.insertAdjacentHTML('beforeend', '<hr>'); return true; }
    if ((cmd === 'bold' || cmd === 'italic' || cmd === 'createLink') && host) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        const txt = sel.toString();
        const tag = cmd === 'bold' ? 'strong' : cmd === 'italic' ? 'em' : 'a';
        const attr = cmd === 'createLink' ? ` href="${val}"` : '';
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createRange().createContextualFragment(`<${tag}${attr}>${txt}</${tag}>`));
      }
      return true;
    }
    if (cmd === 'formatBlock' && host) {
      const tag = val || 'p';
      const el = document.createElement(tag);
      while (host.firstChild) el.appendChild(host.firstChild);
      host.appendChild(el);
      return true;
    }
    return false;
  };
  window.HTMLElement.prototype.focus = function () {};
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 });
  window.scrollY = 0; window.scrollX = 0;

  const editorJs = fs.readFileSync(path.join(__dirname, 'src', 'public', 'js', 'editor.js'), 'utf8');
  window.eval(editorJs);

  const $ = (id) => document.getElementById(id);
  const fire = (el, type, props = {}) => {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, props);
    el.dispatchEvent(e);
  };
  const firePaste = (el, text) => {
    const e = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => text } });
    el.dispatchEvent(e);
  };

  console.log('\n# initial state');
  check('format defaults to html', $('format').value === 'html');
  check('editor-host present', !!$('editor-host'));
  check('editor-host is contenteditable', $('editor-host').contentEditable === 'true');
  check('word-count populated', /\d+ words/.test($('word-count').textContent));

  console.log('\n# normal mode: render content');
  $('editor-host').innerHTML = '<h1>Hello</h1><p>some <strong>bold</strong> text</p>';
  fire($('editor-host'), 'input');
  check('editor-host has content', $('editor-host').innerHTML.includes('Hello'));
  check('editor-host has bold', $('editor-host').innerHTML.includes('<strong>'));

  console.log('\n# normal mode: selection toolbar bold');
  const host = $('editor-host');
  const range = document.createRange();
  range.selectNodeContents(host);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  fire(document, 'selectionchange');
  const boldBtn = document.querySelector('.sel-toolbar [data-cmd="bold"]');
  check('bold button exists', !!boldBtn);
  fire(boldBtn, 'mousedown', { preventDefault() {} });
  check('execCommand(bold) invoked', window.__lastCmd === 'bold');

  console.log('\n# normal mode: + gutter present on empty block');
  host.innerHTML = '<p>one</p><p></p>';
  fire(host, 'input');
  check('gutter-add button appears', !!document.querySelector('.gutter-add'));

  console.log('\n# normal mode: insert image via menu');
  const gutter = document.querySelector('.gutter-add');
  const imgBtn = document.querySelector('.insert-menu [data-insert="image"]');
  window.prompt = () => 'https://x.com/a.png';
  window.openInsertMenu(gutter);
  imgBtn.click();
  fire(host, 'input');
  check('host shows img after insert', host.innerHTML.includes('<img'));
  check('content has img after insert', $('content').value.includes('<img'));

  console.log('\n# normal mode: paste bare URL -> link');
  host.innerHTML = '<p></p>';
  fire(host, 'input');
  const emptyP = host.querySelector('p');
  const r2 = document.createRange();
  r2.selectNode(emptyP);
  const sel2 = window.getSelection(); sel2.removeAllRanges(); sel2.addRange(r2);
  firePaste(host, 'https://example.com/post');
  fire(host, 'input');
  check('host shows link after paste', host.innerHTML.includes('<a href="https://example.com/post">'));
  check('paste URL produced a link', $('content').value.includes('<a href="https://example.com/post">'));

  console.log('\n# hints toggle');
  const help = $('editor-help');
  check('help button exists', !!help);
  const hints = document.querySelector('.editor-hints');
  const wasHidden = hints.hidden;
  fire(help, 'click');
  check('hints toggle flips visibility', hints.hidden !== wasHidden);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
