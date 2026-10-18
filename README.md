# Elina — La niña de la montaña

Experiencia literaria para el libro de Santiago Herrera. Primera parte: prólogo, cinco capítulos, 58 páginas y 38 secciones internas.

## Experiencia

- Portada original en un libro construido con CSS 3D, con apertura interactiva.
- Presentación editorial con paisaje de montaña e ilustraciones originales.
- Lector completo con índice, búsqueda que ignora tildes, tres temas y letra ajustable.
- Marcadores y progreso guardados en `localStorage`, únicamente en el navegador del lector.
- Enlaces directos a capítulos (`#leer/capitulo-1`) y a pasajes.
- Descarga del PDF original, conservado sin modificar.
- Audiolibro con narración sintética en español mediante las voces del dispositivo: reproducción/pausa, voz y velocidad, avance por capítulos, búsqueda de posición y texto resaltado.
- Diseño adaptable, navegación por teclado, diálogo accesible y respeto por movimiento reducido.

No hay cuentas, servicios de analítica ni dependencias de ejecución. La aplicación no llama a una API de voz propia; las voces del sistema pueden ser locales o utilizar el servicio de voz del navegador.

## Audiolibro

El botón **Escuchar el libro** abre los controles. **Reproducir** inicia la voz mediante un gesto explícito, necesario en navegadores móviles. Utiliza Web Speech API (`SpeechSynthesis`) y ofrece las voces en español del dispositivo, con preferencia por Colombia y Latinoamérica. No se proporciona un MP3 ni una voz humana grabada.

La narración divide el texto completo en fragmentos cortos, conserva la última palabra informada por la voz, ignora eventos de reproducciones canceladas y continúa al siguiente capítulo. Guarda su posición separada del progreso de lectura. Los controles permiten cambiar capítulo, fragmento, voz y velocidad, y escuchar desde el párrafo visible. Si el navegador no proporciona límites de palabra, se retoma el fragmento corto en curso.

Se pausa al cerrar el lector, ocultar los controles, cambiar de pestaña o bloquear la pantalla. Mantener la pestaña visible evita prometer reproducción en segundo plano que los navegadores no garantizan. Si la síntesis no existe o no consigue iniciar, se informa al lector sin bloquear el acceso al texto o al PDF.

Referencia de la API: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis

## Desarrollo y verificación

Requiere Node.js 22 o posterior. No se necesita instalar paquetes para compilar.

```sh
npm run check
npm test
npm run build
```

La compilación reconstruye el PDF original desde `book-source/`, comprueba su SHA-256 y copia `public/` a `dist/`. La división del archivo fuente permite subirlo por el conector de GitHub; el lector recibe un único PDF idéntico al original. `vercel.json` deja configurado el despliegue estático en el proyecto `elina`; el repositorio previsto es `santiagoherrera1886-ai/elina`.

Para una vista local, servir `public/` con cualquier servidor HTTP estático. El lector necesita HTTP (no abrir el HTML mediante `file://`).

## Contenido y fidelidad

`public/data/book.json` contiene el texto real extraído del PDF; nunca se genera ni resume el contenido del lector. `scripts/extract_book.py` elimina encabezados/pies repetidos, une líneas y ligaduras tipográficas y compara todos los caracteres no blancos contra la fuente. Conserva los bloques del texto y su página de origen. Incluye «VI. El Hombre que le Sonrió», que sí está en el cuerpo del PDF aunque falta en su índice.

El tiempo de lectura es una estimación de 200 palabras por minuto. El progreso general pondera cada capítulo por su extensión en palabras y la posición de desplazamiento dentro de él. Los marcadores utilizan anclas de párrafo para tolerar cambios de tamaño de letra.

Para actualizar el libro, instalar PyMuPDF y Pillow en un entorno de Python y ejecutar:

```sh
python scripts/extract_book.py /ruta/a/la-nueva-edicion.pdf
npm run check
npm test
npm run build
```

El extractor está adaptado a la estructura de esta edición y debe revisarse si cambia el diseño del PDF.

## Activos visuales

- `cover.webp`, `mountain-ink.webp`, `child-ink.webp`, `fire-ink.webp`, `freedom-ink.webp`: extraídos del PDF del autor y optimizados para web.
- `mountain-landscape.webp`: paisaje interpretativo creado con la herramienta de generación de imágenes integrada. No se presenta como fotografía documental. Dirección: vista panorámica cinematográfica de montañas del norte de Antioquia, capas de bosque, niebla fría, paleta verde salvia y gris, casa rural lejana, sin texto ni personas.
- `favicon.svg`: símbolo de montaña de la aplicación.

## Alcance de las comprobaciones

Las pruebas automatizadas verifican fidelidad y cobertura del contenido, integridad de recursos, selectores de interfaz, búsquedas, enlaces de lectura, persistencia validada y cálculo de progreso. Estas comprobaciones no sustituyen una revisión visual en navegador ni una comprobación del despliegue en producción.
