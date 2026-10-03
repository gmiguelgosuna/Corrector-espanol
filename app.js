/* Profe de apoyo: revisión de textos en español en el navegador.
   No hay servidor propio: el texto va directamente del navegador al servicio de IA elegido. */
(function () {
  'use strict';

  // ---------- Configuración ----------
  const MAX_WORDS = 5000;
  const CHUNK_WORDS = 450;

  const DEFAULT_PROVIDER = 'groq';
  const PROVIDERS = {
    groq: {
      name: 'Groq',
      url: () => 'https://api.groq.com/openai/v1/chat/completions',
      modelsUrl: () => 'https://api.groq.com/openai/v1/models',
      models: () => ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'],
      prefer: [/gpt-oss-120b/i, /llama-3\.3-70b/i, /qwen/i, /llama/i],
      concurrency: 1, // el plan gratuito limita los tokens por minuto
      gapMs: 0,
      free: true,
    },
    mistral: {
      name: 'Mistral',
      url: () => 'https://api.mistral.ai/v1/chat/completions',
      modelsUrl: () => 'https://api.mistral.ai/v1/models',
      models: () => ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
      concurrency: 1,
      gapMs: 1100,
    },
    infomaniak: {
      name: 'Infomaniak',
      url: (s) => `https://api.infomaniak.com/1/ai/${encodeURIComponent(s.productId)}/openai/chat/completions`,
      modelsUrl: (s) => `https://api.infomaniak.com/1/ai/${encodeURIComponent(s.productId)}/openai/models`,
      models: () => ['qwen3', 'gpt-oss-120b', 'mistral3', 'llama3'],
      prefer: [/qwen3/i, /gpt-oss/i, /mistral/i, /llama/i, /apertus/i],
      concurrency: 2,
      gapMs: 0,
    },
  };

  const TYPES = {
    ortografia: 'Ortografía',
    gramatica: 'Gramática',
    concordancia: 'Concordancia',
    puntuacion: 'Puntuación',
    sintaxis: 'Sintaxis',
    estilo: 'Estilo',
  };

  const SYSTEM_PROMPT = [
    'Eres un profesor de apoyo de lengua española, paciente y riguroso. Revisas redacciones de estudiantes siguiendo la norma de la RAE.',
    '',
    'Tarea: detecta los errores REALES del texto: ortografía (incluidas tildes y mayúsculas), gramática, concordancia (género, número, sujeto-verbo), sintaxis (orden, preposiciones, dequeísmo, queísmo, leísmo, laísmo, loísmo) y puntuación.',
    'Señala "estilo" solo cuando una frase sea claramente confusa, repetitiva o impropia; nunca por gustos personales.',
    'Respeta las ideas y la voz del estudiante: corrige, no reescribas. No inventes errores. Si una forma es correcta o admitida, no la marques.',
    '',
    'Para cada error devuelve un objeto con:',
    '- "original": fragmento copiado EXACTAMENTE del texto (mismas letras, tildes, mayúsculas y signos), con 1 a 6 palabras, lo justo para localizar el error sin ambigüedad.',
    '- "correccion": ese mismo fragmento ya corregido.',
    '- "tipo": uno de "ortografia", "gramatica", "concordancia", "puntuacion", "sintaxis", "estilo".',
    '- "regla": nombre breve de la norma (por ejemplo "Tilde diacrítica", "Concordancia sujeto-verbo", "Coma en incisos", "Leísmo", "Haber impersonal").',
    '- "explicacion": 1 o 2 frases claras (máximo 35 palabras) dirigidas al estudiante, que expliquen POR QUÉ se corrige. Si ayuda, añade un ejemplo breve.',
    '',
    'Devuelve los errores en el orden en que aparecen en el texto. Si no hay errores, devuelve una lista vacía.',
    'Responde ÚNICAMENTE con JSON válido con esta forma: {"sugerencias":[{"original":"","correccion":"","tipo":"","regla":"","explicacion":""}]}',
  ].join('\n');

  const SAMPLE_TEXT = [
    'El verano pasado fuimos a la playa con mis primos. Hubieron muchas personas y no encontramos sitio para aparcar. Mi tía, que es muy organizada nos dijo que teníamos que llegar mas temprano. A mis primos les encanta nadar, pero a mí me gusta mas leer en la arena.',
    '',
    'Cuando volvimos a casa, mi madre le preguntó a mis hermanos si se habían divertido. Ellos dijeron que si, aunque estaban cansados. Yo creo que la próxima vez deberíamos de ir en tren, porque es mas cómodo y no hay que buscar aparcamiento. La gente estaban de acuerdo conmigo.',
  ].join('\n');

  // ---------- Utilidades puras ----------
  const countWords = (s) => (s.match(/\S+/g) || []).length;
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (n) => n.toLocaleString('es-ES');
  const deaccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

  /** Divide el documento en secciones de ~CHUNK_WORDS palabras respetando párrafos (y frases si un párrafo es enorme). */
  function splitChunks(doc, limit) {
    limit = limit || CHUNK_WORDS;
    const pieces = [];
    const paraRe = /[^\n]+/g;
    let m;
    while ((m = paraRe.exec(doc))) {
      const p = { start: m.index, end: m.index + m[0].length, words: countWords(m[0]) };
      if (p.words === 0) continue;
      if (p.words <= limit * 1.4) { pieces.push(p); continue; }
      const sentRe = /[^.!?…]+(?:[.!?…]+|$)\s*/g;
      const text = m[0];
      let sm, acc = null;
      while ((sm = sentRe.exec(text))) {
        if (!sm[0]) { sentRe.lastIndex++; continue; }
        const piece = { start: p.start + sm.index, end: p.start + sm.index + sm[0].length, words: countWords(sm[0]) };
        if (acc && acc.words + piece.words > limit) { pieces.push(acc); acc = null; }
        acc = acc ? { start: acc.start, end: piece.end, words: acc.words + piece.words } : piece;
      }
      if (acc) pieces.push(acc);
    }
    const chunks = [];
    let cur = null;
    for (const p of pieces) {
      if (cur && cur.words + p.words > limit) { chunks.push(cur); cur = null; }
      cur = cur ? { start: cur.start, end: p.end, words: cur.words + p.words } : { start: p.start, end: p.end, words: p.words };
    }
    if (cur) chunks.push(cur);
    return chunks.map((c, i) => ({ id: i, start: c.start, end: c.end, status: 'pending', error: '' }));
  }

  function normalizeType(t) {
    const k = deaccent(String(t || '')).toLowerCase().trim();
    if (TYPES[k]) return k;
    if (/tilde|acent|ortogr|mayusc/.test(k)) return 'ortografia';
    if (/concord/.test(k)) return 'concordancia';
    if (/puntu|coma/.test(k)) return 'puntuacion';
    if (/sintax|prepos|orden/.test(k)) return 'sintaxis';
    if (/estil|lexic|vocab|redac/.test(k)) return 'estilo';
    return 'gramatica';
  }

  /** Convierte la respuesta del modelo en una lista validada de sugerencias. Lanza un error si no es JSON utilizable. */
  function parseSuggestions(content) {
    let text = Array.isArray(content) ? content.map((p) => (typeof p === 'string' ? p : p.text || '')).join('') : String(content || '');
    text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    let data;
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      data = JSON.parse(text.slice(firstBracket, text.lastIndexOf(']') + 1));
    } else {
      if (firstBrace === -1) throw new Error('sin JSON');
      data = JSON.parse(text.slice(firstBrace, text.lastIndexOf('}') + 1));
    }
    const list = Array.isArray(data) ? data : data.sugerencias || data.suggestions || data.errores || data.correcciones || [];
    if (!Array.isArray(list)) throw new Error('formato inesperado');
    const out = [];
    for (const it of list) {
      if (!it || typeof it !== 'object') continue;
      const original = typeof it.original === 'string' ? it.original : '';
      const correccion = typeof (it.correccion ?? it.corrección ?? it.correction) === 'string' ? (it.correccion ?? it.corrección ?? it.correction) : null;
      if (!original.trim() || correccion === null || original.length > 400) continue;
      if (correccion === original) continue;
      out.push({
        original,
        correccion,
        tipo: normalizeType(it.tipo || it.type),
        regla: String(it.regla || it.rule || '').trim().slice(0, 120) || TYPES[normalizeType(it.tipo || it.type)],
        explicacion: String(it.explicacion || it.explicación || it.explanation || '').trim().slice(0, 400),
      });
    }
    return out;
  }

  /** Busca cada sugerencia dentro de su sección. Devuelve las que se pueden ubicar sin solaparse con otras. */
  function locate(doc, chunk, items, taken) {
    const text = doc.slice(chunk.start, chunk.end);
    const used = taken.slice();
    const out = [];
    let cursor = 0;
    for (const it of items) {
      let original = it.original;
      let correccion = it.correccion;
      let idx = findFree(text, original, cursor, chunk.start, used);
      if (idx < 0) {
        const trimmed = original.trim();
        if (trimmed && trimmed !== original) {
          original = trimmed;
          correccion = correccion.trim();
          idx = findFree(text, original, cursor, chunk.start, used);
        }
      }
      if (idx < 0 || original === correccion) continue;
      const start = chunk.start + idx;
      const end = start + original.length;
      used.push([start, end]);
      out.push(Object.assign({}, it, { original, correccion, start, end }));
      cursor = idx + original.length;
    }
    return out;
  }

  function findFree(text, needle, cursor, base, used) {
    const tryFrom = (from, until) => {
      let i = text.indexOf(needle, from);
      while (i !== -1 && (until === undefined || i < until)) {
        const s = base + i, e = s + needle.length;
        if (!used.some(([a, b]) => s < b && a < e)) return i;
        i = text.indexOf(needle, i + 1);
      }
      return -1;
    };
    const i = tryFrom(cursor);
    return i !== -1 ? i : tryFrom(0, cursor);
  }

  /** Aplica una sugerencia al documento y desplaza las posiciones posteriores. Devuelve el nuevo documento. */
  function applyFix(doc, s, suggestions, chunks) {
    const oldEnd = s.end;
    const delta = s.correccion.length - (s.end - s.start);
    const next = doc.slice(0, s.start) + s.correccion + doc.slice(s.end);
    s.end = s.start + s.correccion.length;
    for (const o of suggestions) {
      if (o === s) continue;
      if (o.start >= oldEnd) { o.start += delta; o.end += delta; }
    }
    for (const c of chunks) {
      if (c.start >= oldEnd) { c.start += delta; c.end += delta; }
      else if (c.end >= oldEnd) { c.end += delta; }
    }
    return next;
  }

  // ---------- Almacenamiento (siempre tolerante a fallos) ----------
  const store = {
    isShared() {
      try { return localStorage.getItem('pa.shared') === '1'; } catch (e) { return false; }
    },
    area() {
      try { return this.isShared() ? sessionStorage : localStorage; } catch (e) { return null; }
    },
    read(k) {
      try { const a = this.area(); const v = a && a.getItem('pa.' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    },
    write(k, v) {
      try { const a = this.area(); if (a) a.setItem('pa.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ }
    },
    setShared(on) {
      const settings = this.read('settings');
      const draft = this.read('draft');
      this.wipe();
      try { localStorage.setItem('pa.shared', on ? '1' : '0'); } catch (e) { /* ignore */ }
      if (settings) this.write('settings', settings);
      if (draft) this.write('draft', draft);
    },
    wipe() {
      for (const area of ['localStorage', 'sessionStorage']) {
        try {
          const st = window[area];
          Object.keys(st).filter((k) => k.startsWith('pa.')).forEach((k) => st.removeItem(k));
        } catch (e) { /* ignore */ }
      }
    },
  };

  // Exponer funciones puras para pruebas.
  window.PA = { splitChunks, parseSuggestions, locate, applyFix, normalizeType, countWords };

  if (!document.getElementById('input')) return; // página de ayuda u otra

  // ---------- Estado ----------
  let settings = Object.assign({ provider: DEFAULT_PROVIDER, key: '', productId: '', model: '' }, store.read('settings') || {});
  if (!PROVIDERS[settings.provider]) settings.provider = DEFAULT_PROVIDER;
  let doc = '';
  let chunks = [];
  let suggestions = [];
  let selectedId = null;
  let runToken = 0;
  let nextId = 1;
  const hiddenTypes = new Set();
  let fatal = null; // { kind, message }
  let detectedModel = null;
  let detectTried = false;
  let waitUntil = 0; // fin de la espera por límite gratuito (ms), 0 si no se espera

  // ---------- Elementos ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    input: $('input'), count: $('wordCount'), check: $('checkBtn'), file: $('fileInput'), sample: $('sampleBtn'),
    emptyHelp: $('emptyHelp'), editMode: $('editMode'), reviewMode: $('reviewMode'), editBanner: $('editBanner'),
    reviewBanner: $('reviewBanner'), docEl: $('doc'), sheet: $('sheet'), card: $('card'), progress: $('progress'),
    progressLabel: $('progressLabel'), progressBar: $('progressBar'), edit: $('editBtn'), copy: $('copyBtn'),
    download: $('downloadBtn'), how: $('howPanel'), sum: $('sumPanel'), stats: $('stats'), filters: $('filters'),
    listPanel: $('listPanel'), list: $('list'), acceptAll: $('acceptAll'), rejectAll: $('rejectAll'),
    providerName: $('providerName'), dlg: $('settings'), form: $('settingsForm'), apiKey: $('apiKey'),
    toggleKey: $('toggleKey'), testKey: $('testKey'), testMsg: $('testMsg'), productId: $('productId'), model: $('model'), shared: $('shared'),
    infoFields: $('infomaniakFields'), wipe: $('wipeBtn'), msg: $('settingsMsg'), openSettings: $('openSettings'),
  };

  // ---------- Modo edición ----------
  function updateCount() {
    const n = countWords(el.input.value);
    el.count.textContent = `${fmt(n)} / ${fmt(MAX_WORDS)} palabras`;
    el.count.classList.toggle('over', n > MAX_WORDS);
    el.check.disabled = n === 0 || n > MAX_WORDS;
    el.emptyHelp.hidden = n > 0;
  }

  let draftTimer = null;
  function saveDraftSoon(text) {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => store.write('draft', text), 400);
  }

  function banner(target, kind, html, actions) {
    target.innerHTML = '';
    if (!html) return;
    const div = document.createElement('div');
    div.className = 'banner ' + kind;
    div.innerHTML = `<span class="grow">${html}</span>`;
    (actions || []).forEach(([label, fn, cls]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small ' + (cls || '');
      b.textContent = label;
      b.addEventListener('click', fn);
      div.appendChild(b);
    });
    target.appendChild(div);
  }

  el.input.addEventListener('input', () => { updateCount(); saveDraftSoon(el.input.value); });
  el.sample.addEventListener('click', () => { el.input.value = SAMPLE_TEXT; updateCount(); saveDraftSoon(SAMPLE_TEXT); });

  $('uploadBtn').addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', async () => {
    const f = el.file.files && el.file.files[0];
    el.file.value = '';
    if (!f) return;
    banner(el.editBanner, '', '');
    try {
      let text;
      if (/\.txt$/i.test(f.name) || f.type === 'text/plain') {
        text = await f.text();
      } else if (/\.docx$/i.test(f.name)) {
        if (!window.mammoth) throw new Error('El lector de Word no se ha cargado. Recarga la página.');
        const res = await window.mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() });
        text = res.value;
      } else if (/\.doc$/i.test(f.name)) {
        throw new Error('Los archivos .doc antiguos no se pueden leer. En Word, usa «Guardar como» → .docx, o copia y pega el texto.');
      } else {
        throw new Error('Solo se pueden subir archivos .docx o .txt.');
      }
      text = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) throw new Error('El archivo no contiene texto.');
      el.input.value = text;
      updateCount();
      saveDraftSoon(text);
      const n = countWords(text);
      if (n > MAX_WORDS) banner(el.editBanner, 'warn', `El archivo tiene ${fmt(n)} palabras. El máximo es ${fmt(MAX_WORDS)} (unas 10 páginas). Revisa el texto por partes.`);
      else banner(el.editBanner, 'ok', `Se ha cargado «${esc(f.name)}» (${fmt(n)} palabras). El formato (negritas, tablas…) no se conserva.`);
    } catch (e) {
      banner(el.editBanner, 'err', esc(e.message || 'No se pudo leer el archivo.'));
    }
  });

  el.check.addEventListener('click', startReview);

  function hasCredentials() {
    if (!settings.key) return false;
    if (settings.provider === 'infomaniak' && !settings.productId) return false;
    return true;
  }

  function startReview() {
    const text = el.input.value.replace(/\r\n?/g, '\n');
    const n = countWords(text);
    if (!n || n > MAX_WORDS) return;
    if (!hasCredentials()) {
      openSettings('Antes de revisar, pega tu clave de API.');
      return;
    }
    doc = text;
    chunks = splitChunks(doc);
    suggestions = [];
    selectedId = null;
    fatal = null;
    hiddenTypes.clear();
    el.editMode.hidden = true;
    el.reviewMode.hidden = false;
    el.how.hidden = true;
    el.sum.hidden = false;
    el.listPanel.hidden = false;
    banner(el.reviewBanner, '', '');
    renderAll();
    runQueue();
  }

  let confirmEdit = false;
  el.edit.addEventListener('click', () => {
    const pending = suggestions.filter((s) => s.status === 'pending').length;
    if (pending && !confirmEdit) {
      confirmEdit = true;
      el.edit.textContent = `¿Descartar ${pending} pendientes? Pulsa otra vez`;
      setTimeout(() => { confirmEdit = false; el.edit.textContent = 'Editar texto'; }, 4000);
      return;
    }
    confirmEdit = false;
    el.edit.textContent = 'Editar texto';
    runToken++;
    el.input.value = doc;
    store.write('draft', doc);
    suggestions = [];
    chunks = [];
    closeCard();
    el.reviewMode.hidden = true;
    el.editMode.hidden = false;
    el.how.hidden = false;
    el.sum.hidden = true;
    el.listPanel.hidden = true;
    banner(el.editBanner, '', '');
    updateCount();
    el.input.focus();
  });

  // ---------- Llamadas a la IA ----------
  class AppError extends Error {
    constructor(kind, message, isFatal) { super(message); this.kind = kind; this.fatal = !!isFatal; }
  }

  /** Lee el mensaje de error que devuelve el servicio (si lo hay), en una sola línea corta. */
  async function errorDetail(res) {
    const raw = await res.text().catch(() => '');
    let msg = raw;
    try {
      const j = JSON.parse(raw);
      const e = j.error || j;
      msg = (typeof e === 'string' ? e : e.message || e.detail || j.message || j.detail || '') || raw;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch (e) { /* texto plano */ }
    return msg.replace(/\s+/g, ' ').trim().slice(0, 220);
  }

  /** Segundos que pide esperar el servicio tras un 429 (cabeceras retry-after o x-ratelimit-reset-*). */
  function waitSeconds(res) {
    const ra = parseFloat(res.headers.get('retry-after'));
    if (ra > 0) return ra;
    const reset = res.headers.get('x-ratelimit-reset-tokens') || res.headers.get('x-ratelimit-reset-requests');
    if (reset) {
      let total = 0;
      const re = /([\d.]+)\s*(ms|h|m|s)/g;
      let m;
      while ((m = re.exec(reset))) total += parseFloat(m[1]) * ({ ms: 0.001, s: 1, m: 60, h: 3600 }[m[2]]);
      if (total > 0) return total;
    }
    return 0;
  }

  /** Espera mostrando una cuenta atrás en la barra de progreso. */
  async function waitWithCountdown(seconds) {
    waitUntil = Date.now() + seconds * 1000;
    renderProgress();
    const timer = setInterval(renderProgress, 1000);
    try { await sleep(seconds * 1000); } finally { clearInterval(timer); waitUntil = 0; renderProgress(); }
  }

  async function detectModel(p) {
    if (!p.modelsUrl || !p.prefer || detectTried) return null;
    detectTried = true;
    try {
      const r = await fetch(p.modelsUrl(settings), { headers: { Authorization: 'Bearer ' + settings.key } });
      if (!r.ok) return null;
      const j = await r.json();
      const ids = (j.data || j.models || [])
        .map((m) => (typeof m === 'string' ? m : m.id || m.name))
        .filter((id) => id && !/whisper|tts|guard|embed|vision|audio|orpheus|playai/i.test(id));
      for (const re of p.prefer) {
        const hit = ids.find((id) => re.test(id));
        if (hit) return hit;
      }
      return ids[0] || null;
    } catch (e) { return null; }
  }

  async function resolveModel(p, attempt) {
    if (settings.provider === 'infomaniak' && settings.model) return settings.model;
    if (attempt === 0) {
      if (!detectedModel) detectedModel = await detectModel(p);
      if (detectedModel) return detectedModel;
    }
    const list = p.models();
    return list[Math.min(attempt, list.length - 1)];
  }

  async function callAI(text) {
    const p = PROVIDERS[settings.provider] || PROVIDERS[DEFAULT_PROVIDER];
    let useFormat = true;
    let useReasoning = true;
    let modelAttempt = 0;
    let parseRetries = 0;
    let netRetries = 0;
    let rateWaits = 0;
    for (let attempt = 0; attempt < 24; attempt++) {
      const model = await resolveModel(p, modelAttempt);
      const body = {
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Texto del estudiante (entre las marcas <<< y >>>):\n<<<\n' + text + '\n>>>' },
        ],
      };
      if (useFormat) body.response_format = { type: 'json_object' };
      if (useReasoning && settings.provider === 'groq' && /gpt-oss/i.test(model)) body.reasoning_effort = 'low';

      let res;
      try {
        res = await fetch(p.url(settings), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + settings.key, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (netRetries++ < 2) { await sleep(1500 * netRetries); continue; }
        throw new AppError('network', `No se pudo conectar con ${p.name}. Revisa tu conexión a internet. Si el problema continúa, puede que tu red bloquee el servicio: avisa a tu profesor/a.`, true);
      }

      if (res.status === 401) {
        const detail = await errorDetail(res);
        let msg = `${p.name} no acepta tu clave: no es válida o tu plan no permite usar la API.`;
        if (settings.provider === 'mistral') msg += ' El plan Free de Mistral ya no activa claves de API: elige Groq (gratis) en Ajustes.';
        else msg += ' Comprueba que la has copiado entera en Ajustes.';
        throw new AppError('key', msg + (detail ? ` (Mensaje de ${p.name}: «${detail}»)` : ''), true);
      }
      if (res.status === 403) {
        const detail = await errorDetail(res);
        if (!(settings.provider === 'infomaniak' && settings.model) && modelAttempt < p.models().length - 1) {
          detectedModel = null; detectTried = true; modelAttempt++; continue;
        }
        throw new AppError('key', `${p.name} no permite usar este servicio con tu clave.` + (detail ? ` (Mensaje de ${p.name}: «${detail}»)` : ''), true);
      }
      if (res.status === 429) {
        const detail = await errorDetail(res);
        const wait = waitSeconds(res);
        const daily = /per day|\bTPD\b|\bRPD\b|daily|diari/i.test(detail) || wait > 120;
        if (!daily && rateWaits++ < 10) {
          await waitWithCountdown(Math.min(Math.max(wait || 5 * rateWaits, 2), 60));
          continue;
        }
        throw new AppError('limit', daily
          ? `Has alcanzado el límite diario gratuito de ${p.name}. Inténtalo mañana; lo ya revisado no se pierde.`
          : `Has alcanzado el límite de uso de ${p.name} por ahora. Espera unos minutos y pulsa «Reintentar».`, daily);
      }
      if (res.status >= 500) {
        if (rateWaits++ < 4) { await sleep(2000 * Math.pow(2, Math.min(rateWaits, 3))); continue; }
        throw new AppError('limit', `${p.name} no responde ahora mismo. Inténtalo de nuevo en unos minutos.`);
      }
      if (res.status === 400 || res.status === 404 || res.status === 422) {
        const detail = await errorDetail(res);
        if (useReasoning && body.reasoning_effort && /reasoning/i.test(detail)) { useReasoning = false; continue; }
        if (useFormat && /response_format|json/i.test(detail)) { useFormat = false; continue; }
        if (/model/i.test(detail) && !(settings.provider === 'infomaniak' && settings.model) && modelAttempt < p.models().length - 1) {
          detectedModel = null; detectTried = true; modelAttempt++; continue;
        }
        if (useFormat) { useFormat = false; continue; }
        throw new AppError('bad', `${p.name} rechazó la petición (${res.status}).${settings.provider === 'infomaniak' ? ' Revisa el ID del producto y el modelo en Ajustes.' : ''}` + (detail ? ` (Mensaje de ${p.name}: «${detail}»)` : ''), settings.provider === 'infomaniak');
      }
      if (!res.ok) throw new AppError('bad', `Error inesperado de ${p.name} (${res.status}).`);

      const data = await res.json().catch(() => null);
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      try {
        detectedModel = model;
        return parseSuggestions(content);
      } catch (e) {
        if (parseRetries++ < 1) continue;
        throw new AppError('parse', 'La respuesta de la IA no se pudo leer. Pulsa «Reintentar».');
      }
    }
    throw new AppError('limit', 'No se pudo completar la revisión. Pulsa «Reintentar».');
  }

  async function runQueue() {
    const token = ++runToken;
    const p = PROVIDERS[settings.provider] || PROVIDERS[DEFAULT_PROVIDER];
    const worker = async () => {
      for (;;) {
        if (token !== runToken || fatal) return;
        const c = chunks.find((x) => x.status === 'pending');
        if (!c) return;
        c.status = 'running';
        renderProgress();
        const text = doc.slice(c.start, c.end);
        try {
          const items = await callAI(text);
          if (token !== runToken) return;
          const taken = suggestions.map((s) => [s.start, s.end]);
          const found = locate(doc, c, items, taken);
          for (const f of found) suggestions.push(Object.assign(f, { id: nextId++, chunk: c.id, status: 'pending' }));
          suggestions.sort((a, b) => a.start - b.start);
          c.status = 'done';
        } catch (e) {
          if (token !== runToken) return;
          c.status = 'error';
          c.error = e.message || 'Error desconocido';
          if (e.fatal) fatal = { kind: e.kind, message: e.message };
        }
        renderAll();
        if (p.gapMs) await sleep(p.gapMs);
      }
    };
    await Promise.all(Array.from({ length: p.concurrency }, worker));
    if (token !== runToken) return;
    if (fatal) {
      chunks.forEach((c) => { if (c.status === 'pending') { c.status = 'error'; c.error = fatal.message; } });
    }
    renderAll();
  }

  function retryFailed() {
    fatal = null;
    chunks.forEach((c) => { if (c.status === 'error') { c.status = 'pending'; c.error = ''; } });
    banner(el.reviewBanner, '', '');
    renderAll();
    runQueue();
  }

  // ---------- Aceptar / rechazar ----------
  function accept(s) {
    if (!s || s.status !== 'pending') return;
    doc = applyFix(doc, s, suggestions, chunks);
    s.status = 'accepted';
    store.write('draft', doc);
  }
  function reject(s) {
    if (!s || s.status !== 'pending') return;
    s.status = 'rejected';
  }
  function visiblePending() {
    return suggestions.filter((s) => s.status === 'pending' && !hiddenTypes.has(s.tipo));
  }
  function selectNextAfter(s) {
    const pend = visiblePending();
    const next = pend.find((o) => o.start >= s.start) || pend[0];
    selectedId = next ? next.id : null;
  }

  el.acceptAll.addEventListener('click', () => {
    // De atrás hacia delante para que las posiciones no cambien mientras se aplica.
    visiblePending().sort((a, b) => b.start - a.start).forEach(accept);
    selectedId = null;
    renderAll();
  });
  el.rejectAll.addEventListener('click', () => {
    visiblePending().forEach(reject);
    selectedId = null;
    renderAll();
  });

  // ---------- Pintado ----------
  function renderAll() {
    renderDoc();
    renderProgress();
    renderSummary();
    renderList();
    renderCard();
  }

  function renderDoc() {
    const marks = suggestions
      .filter((s) => s.status === 'pending' || (s.status === 'accepted' && s.end > s.start))
      .sort((a, b) => a.start - b.start);
    let html = '';
    let pos = 0;
    for (const s of marks) {
      if (s.start < pos) continue;
      html += esc(doc.slice(pos, s.start));
      const frag = esc(doc.slice(s.start, s.end));
      if (s.status === 'accepted') {
        html += `<span class="fixed" title="Corregido">${frag}</span>`;
      } else {
        const cls = ['sug', 't-' + s.tipo];
        if (hiddenTypes.has(s.tipo)) cls.push('dim');
        if (s.id === selectedId) cls.push('sel');
        if (s.start === s.end) cls.push('zero');
        html += `<mark class="${cls.join(' ')}" data-id="${s.id}" tabindex="0" role="button" aria-label="${esc(TYPES[s.tipo] + ': ' + s.original + ' → ' + (s.correccion || '(eliminar)'))}">${frag}</mark>`;
      }
      pos = s.end;
    }
    html += esc(doc.slice(pos));
    el.docEl.innerHTML = html;
  }

  function renderProgress() {
    const total = chunks.length;
    const finished = chunks.filter((c) => c.status === 'done' || c.status === 'error').length;
    const failed = chunks.filter((c) => c.status === 'error');
    const running = chunks.some((c) => c.status === 'running' || c.status === 'pending');
    el.progressBar.style.width = total ? Math.round((finished / total) * 100) + '%' : '0';
    if (running && !fatal) {
      const current = Math.min(finished + 1, total);
      const left = Math.ceil((waitUntil - Date.now()) / 1000);
      const pname = (PROVIDERS[settings.provider] || PROVIDERS[DEFAULT_PROVIDER]).name;
      el.progressLabel.textContent = left > 0
        ? `Sección ${current} de ${total}: esperando al límite por minuto de ${pname} (${left} s)… No cierres la página.`
        : `Revisando sección ${current} de ${total}… Puedes ir aceptando o rechazando mientras tanto.`;
      el.progress.hidden = false;
    } else {
      el.progress.hidden = true;
    }
    if (fatal) {
      banner(el.reviewBanner, 'err', esc(fatal.message), [
        ['Abrir ajustes', () => openSettings()],
        ['Reintentar', retryFailed, 'primary'],
      ]);
    } else if (!running && failed.length) {
      banner(el.reviewBanner, 'warn', `No se pudieron revisar ${failed.length} de ${total} secciones. ${esc(failed[0].error)}`, [
        ['Reintentar', retryFailed, 'primary'],
      ]);
    } else if (!running && total) {
      const pending = suggestions.filter((s) => s.status === 'pending').length;
      if (!suggestions.length) banner(el.reviewBanner, 'ok', '¡Muy bien! No se han encontrado errores en tu texto.');
      else if (!pending) banner(el.reviewBanner, 'ok', 'Has revisado todas las sugerencias. Copia o descarga tu texto corregido.');
      else banner(el.reviewBanner, '', '');
    }
  }

  function renderSummary() {
    const pend = suggestions.filter((s) => s.status === 'pending').length;
    const acc = suggestions.filter((s) => s.status === 'accepted').length;
    const rej = suggestions.filter((s) => s.status === 'rejected').length;
    el.stats.innerHTML = `<span><b>${pend}</b> pendientes</span><span><b>${acc}</b> aceptadas</span><span><b>${rej}</b> rechazadas</span>`;
    const counts = {};
    suggestions.forEach((s) => { if (s.status === 'pending') counts[s.tipo] = (counts[s.tipo] || 0) + 1; });
    el.filters.innerHTML = '';
    Object.keys(TYPES).forEach((t) => {
      if (!counts[t] && !hiddenTypes.has(t)) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip t-' + t;
      b.setAttribute('aria-pressed', hiddenTypes.has(t) ? 'false' : 'true');
      b.title = hiddenTypes.has(t) ? 'Mostrar' : 'Ocultar';
      b.textContent = `${TYPES[t]} ${counts[t] || 0}`;
      b.addEventListener('click', () => {
        if (hiddenTypes.has(t)) hiddenTypes.delete(t); else hiddenTypes.add(t);
        const sel = suggestions.find((s) => s.id === selectedId);
        if (sel && hiddenTypes.has(sel.tipo)) selectedId = null;
        renderAll();
      });
      el.filters.appendChild(b);
    });
    const vis = visiblePending().length;
    el.acceptAll.disabled = el.rejectAll.disabled = vis === 0;
  }

  function renderList() {
    el.list.innerHTML = '';
    const shown = suggestions.filter((s) => !hiddenTypes.has(s.tipo));
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'count';
      li.textContent = chunks.some((c) => c.status === 'pending' || c.status === 'running')
        ? 'Las sugerencias aparecerán aquí en cuanto estén listas.'
        : 'No hay sugerencias que mostrar.';
      el.list.appendChild(li);
      return;
    }
    for (const s of shown) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item t-' + s.tipo + (s.id === selectedId ? ' sel' : '') + (s.status !== 'pending' ? ' done' : '');
      b.style.setProperty('--c', `var(--t-${s.tipo})`);
      const state = s.status === 'accepted' ? 'Aceptada' : s.status === 'rejected' ? 'Rechazada' : '';
      b.innerHTML = `<span class="state">${state}</span><span class="what">${esc(TYPES[s.tipo])} · ${esc(s.regla)}</span>` +
        `<span class="fix"><span class="old">${esc(s.original)}</span> → <span class="new">${s.correccion ? esc(s.correccion) : '<i>(eliminar)</i>'}</span></span>`;
      b.addEventListener('click', () => {
        if (s.status !== 'pending') return;
        selectedId = s.id;
        renderAll();
        const m = el.docEl.querySelector(`mark[data-id="${s.id}"]`);
        if (m) m.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      if (s.status !== 'pending') b.setAttribute('aria-disabled', 'true');
      li.appendChild(b);
      el.list.appendChild(li);
    }
  }

  function renderCard() {
    const s = suggestions.find((x) => x.id === selectedId && x.status === 'pending');
    if (!s) { el.card.hidden = true; return; }
    el.card.style.setProperty('--c', `var(--t-${s.tipo})`);
    el.card.innerHTML =
      `<div class="head"><span class="chip static t-${s.tipo}">${esc(TYPES[s.tipo])}</span>` +
      `<button class="btn ghost close" type="button" data-act="close" aria-label="Cerrar">✕</button></div>` +
      `<p class="rule">${esc(s.regla)}</p>` +
      `<p class="change"><span class="old">${esc(s.original)}</span><span class="arrow">→</span><span class="new">${s.correccion ? esc(s.correccion) : '<i>(eliminar)</i>'}</span></p>` +
      (s.explicacion ? `<p class="why">${esc(s.explicacion)}</p>` : '') +
      `<div class="buttons"><button class="btn ok" type="button" data-act="accept">Aceptar</button>` +
      `<button class="btn" type="button" data-act="reject">Rechazar</button></div>`;
    el.card.hidden = false;
    const m = el.docEl.querySelector(`mark[data-id="${s.id}"]`);
    if (m) {
      const sheetBox = el.sheet.getBoundingClientRect();
      const box = m.getBoundingClientRect();
      const width = el.card.offsetWidth;
      let left = box.left - sheetBox.left;
      left = Math.max(8, Math.min(left, el.sheet.clientWidth - width - 8));
      el.card.style.left = left + 'px';
      el.card.style.top = (box.bottom - sheetBox.top + 8) + 'px';
    }
  }

  // En el móvil la tarjeta ocupa la parte de abajo: sube la palabra seleccionada para que no quede tapada.
  function keepVisibleOnPhone() {
    if (window.innerWidth > 700 || el.card.hidden) return;
    const m = el.docEl.querySelector(`mark[data-id="${selectedId}"]`);
    if (!m) return;
    const r = m.getBoundingClientRect();
    if (r.bottom > el.card.getBoundingClientRect().top - 12) {
      window.scrollBy({ top: r.top - window.innerHeight * 0.25, behavior: 'smooth' });
    }
  }

  function closeCard() { selectedId = null; el.card.hidden = true; }

  el.card.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const s = suggestions.find((x) => x.id === selectedId);
    if (act.dataset.act === 'close') { closeCard(); renderAll(); return; }
    if (!s) return;
    if (act.dataset.act === 'accept') accept(s);
    if (act.dataset.act === 'reject') reject(s);
    selectNextAfter(s);
    renderAll();
    const m = selectedId && el.docEl.querySelector(`mark[data-id="${selectedId}"]`);
    if (m) {
      m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const btn = el.card.querySelector('[data-act="accept"]');
      if (btn) btn.focus({ preventScroll: true });
      keepVisibleOnPhone();
    }
  });

  el.docEl.addEventListener('click', (e) => {
    const m = e.target.closest('mark[data-id]');
    if (!m) { if (selectedId) { closeCard(); renderAll(); } return; }
    selectedId = Number(m.dataset.id);
    renderAll();
    keepVisibleOnPhone();
  });
  el.docEl.addEventListener('keydown', (e) => {
    const m = e.target.closest('mark[data-id]');
    if (m && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectedId = Number(m.dataset.id); renderAll(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectedId && !el.dlg.open) { closeCard(); renderAll(); }
  });
  window.addEventListener('resize', () => { if (selectedId) renderCard(); });

  // ---------- Copiar / descargar ----------
  el.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(doc);
      flash(el.copy, 'Copiado ✓', 'Copiar texto');
    } catch (e) {
      const r = document.createRange();
      r.selectNodeContents(el.docEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      flash(el.copy, 'Pulsa Ctrl+C', 'Copiar texto');
    }
  });
  el.download.addEventListener('click', () => {
    const blob = new Blob([doc], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'texto-corregido.txt';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  function flash(btn, text, back) {
    btn.textContent = text;
    setTimeout(() => { btn.textContent = back; }, 1800);
  }

  // ---------- Ajustes ----------
  function syncProviderUI() {
    const prov = el.form.elements.provider.value;
    el.infoFields.hidden = prov !== 'infomaniak';
  }
  function openSettings(message) {
    el.form.elements.provider.value = settings.provider;
    el.apiKey.value = settings.key || '';
    el.apiKey.type = 'password';
    el.toggleKey.textContent = 'Mostrar';
    el.productId.value = settings.productId || '';
    el.model.value = settings.model || '';
    el.shared.checked = store.isShared();
    el.msg.textContent = message || '';
    el.msg.style.color = message ? 'var(--warn-ink)' : '';
    el.msg.dataset.warned = '';
    setMsg(el.testMsg, '', '');
    wipeArmed = false;
    el.wipe.textContent = 'Borrar mis datos de este equipo';
    syncProviderUI();
    if (!el.dlg.open) el.dlg.showModal();
    setTimeout(() => (settings.key ? el.dlg.querySelector('#saveSettings') : el.apiKey).focus(), 30);
  }
  el.openSettings.addEventListener('click', () => openSettings());
  el.form.addEventListener('change', (e) => { if (e.target.name === 'provider') syncProviderUI(); });
  el.toggleKey.addEventListener('click', () => {
    const show = el.apiKey.type === 'password';
    el.apiKey.type = show ? 'text' : 'password';
    el.toggleKey.textContent = show ? 'Ocultar' : 'Mostrar';
  });
  /** Si la clave parece de otro servicio, devuelve un aviso (y cambia el servicio cuando lo reconoce). */
  function keyMismatch(prov, key) {
    if (/^sk-ant-/.test(key)) return 'Esta clave es de Claude (Anthropic), que esta herramienta no usa. Crea una clave gratis de Groq.';
    if (/^gsk_/.test(key) && prov !== 'groq') {
      el.form.elements.provider.value = 'groq';
      syncProviderUI();
      return 'Esta clave es de Groq: he cambiado el servicio a Groq. Pulsa «Guardar» otra vez.';
    }
    if (prov === 'groq' && key && !/^gsk_/.test(key)) return 'Las claves de Groq empiezan por «gsk_». Comprueba que has elegido el servicio correcto.';
    return '';
  }

  function setMsg(target, text, kind) {
    target.textContent = text;
    target.style.color = kind === 'err' ? 'var(--err-ink)' : kind === 'ok' ? 'var(--fixed-ink)' : kind === 'warn' ? 'var(--warn-ink)' : '';
  }

  el.testKey.addEventListener('click', async () => {
    const prov = el.form.elements.provider.value;
    const key = el.apiKey.value.trim();
    const pid = el.productId.value.trim();
    const p = PROVIDERS[prov];
    if (!key) { setMsg(el.testMsg, 'Primero pega la clave.', 'err'); return; }
    if (prov === 'infomaniak' && !pid) { setMsg(el.testMsg, 'Falta el ID del producto.', 'err'); return; }
    const hint = keyMismatch(prov, key);
    if (hint && /^sk-ant-/.test(key)) { setMsg(el.testMsg, hint, 'err'); return; }
    setMsg(el.testMsg, 'Probando la clave…', '');
    el.testKey.disabled = true;
    try {
      const res = await fetch(PROVIDERS[el.form.elements.provider.value].modelsUrl({ productId: pid }), { headers: { Authorization: 'Bearer ' + key } });
      const name = PROVIDERS[el.form.elements.provider.value].name;
      if (res.ok) {
        setMsg(el.testMsg, `Clave correcta ✓ ${name} la acepta. Pulsa «Guardar».`, 'ok');
      } else {
        const detail = await errorDetail(res);
        let msg = `${name} rechaza la clave (${res.status}).`;
        if (el.form.elements.provider.value === 'mistral' && res.status === 401) msg += ' El plan Free de Mistral ya no activa claves de API: usa Groq.';
        setMsg(el.testMsg, msg + (detail ? ` Mensaje: «${detail}»` : ''), 'err');
      }
    } catch (e) {
      setMsg(el.testMsg, `No se pudo conectar con ${p.name}. Revisa tu conexión; si sigue fallando, puede que tu red lo bloquee.`, 'err');
    } finally {
      el.testKey.disabled = false;
    }
  });

  el.form.addEventListener('submit', (e) => {
    const action = e.submitter && e.submitter.value;
    if (action !== 'save') return;
    e.preventDefault();
    const prov = el.form.elements.provider.value;
    const key = el.apiKey.value.trim();
    const pid = el.productId.value.trim();
    if (!key) { el.msg.style.color = 'var(--err-ink)'; el.msg.textContent = 'Falta la clave.'; el.apiKey.focus(); return; }
    const mismatch = keyMismatch(prov, key);
    if (mismatch && !(prov === 'groq' && !/^sk-ant-/.test(key) && el.msg.dataset.warned === key)) {
      setMsg(el.msg, mismatch, /^sk-ant-/.test(key) ? 'err' : 'warn');
      if (prov === 'groq' && !/^(sk-ant-|gsk_)/.test(key)) el.msg.dataset.warned = key; // segundo «Guardar» lo acepta igualmente
      return;
    }
    if (prov === 'infomaniak' && !pid) { el.msg.style.color = 'var(--err-ink)'; el.msg.textContent = 'Falta el ID del producto.'; el.productId.focus(); return; }
    const changed = prov !== settings.provider || key !== settings.key || pid !== settings.productId || el.model.value.trim() !== settings.model;
    settings = { provider: prov, key, productId: pid, model: el.model.value.trim() };
    if (changed) { detectedModel = null; detectTried = false; }
    if (el.shared.checked !== store.isShared()) store.setShared(el.shared.checked);
    store.write('settings', settings);
    if (!el.reviewMode.hidden) store.write('draft', doc); else store.write('draft', el.input.value);
    updateProviderName();
    el.dlg.close();
    if (fatal && !el.reviewMode.hidden) retryFailed();
  });

  let wipeArmed = false;
  el.wipe.addEventListener('click', () => {
    if (!wipeArmed) {
      wipeArmed = true;
      el.wipe.textContent = '¿Seguro? Pulsa otra vez';
      return;
    }
    store.wipe();
    settings = { provider: DEFAULT_PROVIDER, key: '', productId: '', model: '' };
    detectedModel = null;
    detectTried = false;
    el.apiKey.value = '';
    el.productId.value = '';
    el.model.value = '';
    el.shared.checked = false;
    el.form.elements.provider.value = DEFAULT_PROVIDER;
    syncProviderUI();
    if (el.reviewMode.hidden) { el.input.value = ''; updateCount(); }
    wipeArmed = false;
    el.wipe.textContent = 'Borrar mis datos de este equipo';
    el.msg.style.color = '';
    el.msg.textContent = 'Datos borrados de este equipo.';
    updateProviderName();
  });

  function updateProviderName() {
    el.providerName.textContent = (PROVIDERS[settings.provider] || PROVIDERS[DEFAULT_PROVIDER]).name;
  }

  // ---------- Inicio ----------
  const draft = store.read('draft');
  if (typeof draft === 'string' && draft) el.input.value = draft;
  updateCount();
  updateProviderName();
})();
