# Profe de apoyo

Herramienta web gratuita para que estudiantes revisen la **ortografía, gramática, puntuación y sintaxis** de sus textos en español (hasta unas 10 páginas). Cada corrección incluye la regla y una explicación breve, y el estudiante decide si la **acepta o la rechaza**.

**Enlace para compartir con la clase:** https://gmiguelgosuna.github.io/Corrector-espanol/

## Para el profesor o la profesora

1. Comparte el enlace con tus estudiantes.
2. Cada estudiante necesita una **clave de API gratuita de Groq** (sin tarjeta). La página [Ayuda](https://gmiguelgosuna.github.io/Corrector-espanol/ayuda.html#clave) explica paso a paso cómo conseguirla (unos 5 minutos).
3. Nunca publiques una clave en este repositorio ni en una web. Si una clave se filtra, bórrala en la consola del servicio y crea otra.
4. Otras opciones en *Ajustes*: **Infomaniak** (de pago, en Suiza) y **Mistral** (de pago: su plan gratuito ya no activa claves de API).

### Privacidad, en resumen
- No hay servidor propio: el texto va directamente del navegador del estudiante al servicio elegido (Groq, Infomaniak o Mistral).
- GitHub solo aloja la página; no ve los textos ni las claves.
- Groq indica que no usa los textos para entrenar ni los guarda de forma permanente. Aun así, pide a tus estudiantes que no incluyan datos personales.
- Las condiciones de Groq exigen 18 años o la aceptación de madre, padre o tutor.
- En ordenadores compartidos, activa *Ajustes → Ordenador compartido*.
- La página no carga nada de otras webs: las fuentes y el lector de Word están incluidos en el repositorio.

### Cambiar algo
Pídelo a Claude (por ejemplo: «cambia el límite a 15 páginas» o «añade una opción de tono formal»). Los cambios se publican solos al subirlos a la rama `main`.

---

## For maintainers (English)

- Static site: `index.html`, `ayuda.html`, `styles.css`, `app.js`. No build step.
- Calls the provider directly from the browser (OpenAI-style `chat/completions`):
  - Groq (default, free): `https://api.groq.com/openai/v1/chat/completions`, model auto-detected from `/openai/v1/models` (prefers `gpt-oss-120b`, then `llama-3.3-70b`)
  - Mistral (paid): `https://api.mistral.ai/v1/chat/completions`, model `mistral-large-latest`
  - Infomaniak: `https://api.infomaniak.com/1/ai/{product_id}/openai/chat/completions` (model auto-detected from `/openai/models`, or set in Settings)
- Long texts are split into ~450-word sections. Groq and Mistral run them one at a time, Infomaniak two at a time. 429 responses wait for `retry-after` / `x-ratelimit-reset-*` (up to 60 s, with a countdown); a daily-limit 429 stops with a clear message.
- Keys and drafts are stored in `localStorage` (or `sessionStorage` with "Ordenador compartido").
- Deployed by `.github/workflows/pages.yml`. One-time setup: **Settings → Pages → Source: GitHub Actions**.
- Vendored: `vendor/mammoth.browser.min.js` (mammoth 1.13.0, BSD-2-Clause), Literata and Figtree fonts (SIL OFL 1.1).
