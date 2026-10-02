# Profe de apoyo

Herramienta web gratuita para que estudiantes revisen la **ortografía, gramática, puntuación y sintaxis** de sus textos en español (hasta unas 10 páginas). Cada corrección incluye la regla y una explicación breve, y el estudiante decide si la **acepta o la rechaza**.

**Enlace para compartir con la clase:** https://gmiguelgosuna.github.io/grammar-helper/

## Para el profesor o la profesora

1. Comparte el enlace con tus estudiantes.
2. Cada estudiante necesita una **clave de API gratuita de Mistral**. La página [Ayuda](https://gmiguelgosuna.github.io/grammar-helper/ayuda.html#clave) explica paso a paso cómo conseguirla (unos 5 minutos).
3. Alternativa: crea tú una clave y compártela en privado con la clase (en la pizarra, por correo…). Nunca la publiques en este repositorio ni en una web. Si se filtra, bórrala en Mistral y crea otra.
4. Si prefieres que los textos no se usen para entrenar la IA, usa **Infomaniak** (de pago, en Suiza) y elige ese servicio en *Ajustes*.

### Privacidad, en resumen
- No hay servidor propio: el texto va directamente del navegador del estudiante a Mistral o Infomaniak.
- GitHub solo aloja la página; no ve los textos ni las claves.
- En el plan gratuito de Mistral, los textos pueden usarse para entrenar su IA. Pide a tus estudiantes que no incluyan datos personales.
- En ordenadores compartidos, activa *Ajustes → Ordenador compartido*.
- La página no carga nada de otras webs: las fuentes y el lector de Word están incluidos en el repositorio.

### Cambiar algo
Pídelo a Claude (por ejemplo: «cambia el límite a 15 páginas» o «añade una opción de tono formal»). Los cambios se publican solos al subirlos a la rama `main`.

---

## For maintainers (English)

- Static site: `index.html`, `ayuda.html`, `styles.css`, `app.js`. No build step.
- Calls the provider directly from the browser (OpenAI-style `chat/completions`):
  - Mistral: `https://api.mistral.ai/v1/chat/completions`, model `mistral-large-latest`
  - Infomaniak: `https://api.infomaniak.com/1/ai/{product_id}/openai/chat/completions` (model auto-detected from `/openai/models`, or set in Settings)
- Long texts are split into ~450-word sections. Mistral runs them one at a time (free tier ~1 request/second), Infomaniak two at a time. 429/5xx responses are retried with backoff.
- Keys and drafts are stored in `localStorage` (or `sessionStorage` with "Ordenador compartido").
- Deployed by `.github/workflows/pages.yml`. One-time setup: **Settings → Pages → Source: GitHub Actions**.
- Vendored: `vendor/mammoth.browser.min.js` (mammoth 1.13.0, BSD-2-Clause), Literata and Figtree fonts (SIL OFL 1.1).
