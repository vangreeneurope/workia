/**
 * Modo demostración (ADR-070): build estático publicado en GitHub Pages con
 * datos ficticios del entorno E2E. Se fija al construir (DEMO_BUILD=1) y
 * nunca se activa en staging ni producción (scripts/demo/build.sh).
 */
export const IS_DEMO = process.env.APP_DEMO === "1";
