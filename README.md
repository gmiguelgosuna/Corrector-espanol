# Profe de apoyo

Herramienta web gratuita para que estudiantes revisen la **ortografía, gramática, puntuación y sintaxis** de sus textos en español (hasta unas 10 páginas). Cada corrección incluye la regla y una explicación breve, y el estudiante decide si la **acepta o la rechaza**.

**Enlace para compartir con la clase:** https://gmiguelgosuna.github.io/Corrector-espanol/

## Para el profesor o la profesora

1. Comparte el enlace con tus estudiantes.
2. Cada estudiante pega su propia **clave de API**. Recomendamos **Infomaniak** (la más segura); **Groq** es la forma más rápida de conseguir una clave gratis, sin tarjeta. La página [Ayuda](https://gmiguelgosuna.github.io/Corrector-espanol/ayuda.html#clave) explica paso a paso cómo conseguir cada una.
3. Nunca publiques una clave en este repositorio ni en una web. Si una clave se filtra, bórrala en la consola del servicio y crea otra.
4. En *Ajustes* se elige el servicio: Infomaniak, Groq u otro proveedor compatible con la API de OpenAI. Recomendamos leer las condiciones de uso y la política de privacidad de cualquier servicio de IA antes de usarlo.

### Servicios de IA
| Servicio | Etiqueta | Coste | Uso | Entrenamiento con los textos | Dónde se procesan |
|---|---|---|---|---|---|
| **Infomaniak** | **Recomendada · Más segura** | 1 M de créditos gratis para empezar; después, céntimos por texto | Según saldo | Nunca | Solo Suiza, sin registros |
| **Groq** | **La más rápida de configurar** | Gratis, sin tarjeta | ~6 textos largos/día por cuenta; se renueva cada minuto y a lo largo de 24 h | No, según sus condiciones | EE. UU., sin almacenamiento por defecto |
| **Otro proveedor** | — | Según el servicio | Según el servicio | Consultar sus condiciones | Según el servicio |

### Variantes del español
El corrector sigue la norma panhispánica (RAE y ASALE) y acepta todas las variedades cultas: voseo, *ustedes*, vocabulario regional, etc. Solo señala errores y la mezcla de variantes dentro del mismo texto. El estudiante puede elegir su variante o dejarla en «Automática».

### Privacidad, en resumen
- No hay servidor propio: el texto va directamente del navegador del estudiante al servicio elegido (Infomaniak, Groq u otro proveedor).
- GitHub solo aloja la página; no ve los textos ni las claves.
- Como buena práctica, pide a tus estudiantes que no incluyan datos personales en los textos.
- Las condiciones de Groq exigen 18 años o la aceptación de madre, padre o tutor.
- En ordenadores compartidos, activa *Ajustes → Ordenador compartido*.
- La página no carga nada de otras webs: las fuentes y el lector de Word están incluidos en el repositorio.

### Cambiar algo
Pídelo a Claude (por ejemplo: «cambia el límite a 15 páginas» o «añade una opción de tono formal»). Los cambios se publican solos al subirlos a la rama `main`.

---

## For maintainers (English)

- Static site: `index.html`, `ayuda.html`, `styles.css`, `app.js`. No build step.
- Calls the provider directly from the browser (OpenAI-style `chat/completions`):
  - Groq (free): `https://api.groq.com/openai/v1/chat/completions`, model auto-detected from `/openai/v1/models` (prefers `gpt-oss-120b`, then `llama-3.3-70b`)
  - Other provider: any OpenAI-compatible base URL (`{base}/chat/completions`, `{base}/models`) plus optional model name. Saved Mistral settings are migrated to this option.
  - Infomaniak (default): `https://api.infomaniak.com/1/ai/{product_id}/openai/chat/completions` (model auto-detected from `/openai/models`, or set in Settings)
- Long texts are split into ~450-word sections. Groq and custom providers run them one at a time, Infomaniak two at a time. 429 responses wait for `retry-after` / `x-ratelimit-reset-*` (up to 60 s, with a countdown); a daily-limit 429 stops with a clear message.
- Keys and drafts are stored in `localStorage` (or `sessionStorage` with "Ordenador compartido").
- Deployed by `.github/workflows/pages.yml`. One-time setup: **Settings → Pages → Source: GitHub Actions**.
- Vendored: `vendor/mammoth.browser.min.js` (mammoth 1.13.0, BSD-2-Clause), Literata and Figtree fonts (SIL OFL 1.1).
