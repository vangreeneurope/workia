"use client";

import { History, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  applyFields,
  formKey,
  FORM_SUCCESS_EVENT,
  isApplyingDraft,
  isDraftable,
  loadDrafts,
  readFields,
  saveDrafts,
} from "@/lib/drafts";

const SAVE_DELAY_MS = 400;
/** Tras enviar, una navegación en este plazo se toma como éxito (redirección). */
const SUBMIT_WINDOW_MS = 15000;
/** La pantalla puede tardar en montar sus formularios (datos en streaming). */
const RESTORE_ATTEMPTS_MS = [0, 400, 1200, 2500];

function formsIn(root: ParentNode): HTMLFormElement[] {
  return [...root.querySelectorAll("form")];
}

/**
 * Autoguardado de lo escrito en los formularios de la zona privada (ADR-069).
 * Ver src/lib/drafts.ts para qué se guarda, dónde y cuándo se borra.
 */
export function DraftKeeper({ userId }: { userId: string }) {
  const pathname = usePathname();
  const [restored, setRestored] = useState<{ form: HTMLFormElement; key: string } | null>(null);
  const lastSubmitted = useRef<string | null>(null);
  const timers = useRef(new Map<string, number>());
  // Formularios en los que la persona ya ha escrito en esta pantalla: no se
  // sobrescriben con un borrador (los eventos propios de applyFields no cuentan).
  const touched = useRef(new WeakSet<HTMLFormElement>());

  // Guardar mientras se escribe; marcar al enviar.
  useEffect(() => {
    const root = document.getElementById("contenido");
    if (!root) return;
    const pending = timers.current;

    const keyOf = (form: HTMLFormElement) => formKey(pathname, form, formsIn(root).indexOf(form));

    const save = (form: HTMLFormElement) => {
      const key = keyOf(form);
      const fields = readFields(form);
      const store = loadDrafts(userId);
      if (Object.keys(fields).length === 0) delete store[key];
      else store[key] = { savedAt: Date.now(), fields };
      saveDrafts(userId, store);
    };

    const onInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !isDraftable(target)) return;
      const form = target.form;
      if (!form || !root.contains(form)) return;
      if (!isApplyingDraft()) touched.current.add(form);
      const key = keyOf(form);
      window.clearTimeout(pending.get(key));
      pending.set(
        key,
        window.setTimeout(() => {
          pending.delete(key);
          save(form);
        }, SAVE_DELAY_MS),
      );
    };

    const onSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !root.contains(form)) return;
      const key = keyOf(form);
      window.clearTimeout(pending.get(key));
      pending.delete(key);
      const fields = readFields(form);
      if (Object.keys(fields).length === 0) return;
      const store = loadDrafts(userId);
      store[key] = { savedAt: Date.now(), fields, submittedAt: Date.now() };
      saveDrafts(userId, store);
      lastSubmitted.current = key;
    };

    root.addEventListener("input", onInput, true);
    root.addEventListener("change", onInput, true);
    root.addEventListener("submit", onSubmit, true);
    return () => {
      root.removeEventListener("input", onInput, true);
      root.removeEventListener("change", onInput, true);
      root.removeEventListener("submit", onSubmit, true);
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, [pathname, userId]);

  // Un envío confirmado borra su borrador.
  useEffect(() => {
    const onSuccess = () => {
      const key = lastSubmitted.current;
      if (!key) return;
      lastSubmitted.current = null;
      const store = loadDrafts(userId);
      delete store[key];
      saveDrafts(userId, store);
    };
    window.addEventListener(FORM_SUCCESS_EVENT, onSuccess);
    return () => window.removeEventListener(FORM_SUCCESS_EVENT, onSuccess);
  }, [userId]);

  // Al llegar a una pantalla: lo enviado justo antes en otra pantalla fue un
  // éxito (redirigió); lo de esta pantalla se recupera en sus formularios.
  useEffect(() => {
    const root = document.getElementById("contenido");
    if (!root) return;
    const now = Date.now();
    const store = loadDrafts(userId, now);
    let dirty = false;
    for (const [key, draft] of Object.entries(store)) {
      const samePage = key.startsWith(`${pathname}|`);
      if (draft.submittedAt === undefined) continue;
      if (!samePage && now - draft.submittedAt < SUBMIT_WINDOW_MS) {
        delete store[key];
      } else {
        // Enviado sin confirmación (p. ej. la sesión se cerró): vuelve a ser borrador.
        delete draft.submittedAt;
      }
      dirty = true;
    }
    if (dirty) saveDrafts(userId, store);

    touched.current = new WeakSet();
    const done = new Set<string>();
    const attempts = RESTORE_ATTEMPTS_MS.map((delay) =>
      window.setTimeout(() => {
        const current = loadDrafts(userId);
        const forms = formsIn(root);
        forms.forEach((form, index) => {
          const key = formKey(pathname, form, index);
          const draft = current[key];
          if (!draft || done.has(key) || touched.current.has(form)) return;
          done.add(key);
          if (applyFields(form, draft.fields) > 0) setRestored({ form, key });
        });
      }, delay),
    );
    return () => {
      for (const timer of attempts) window.clearTimeout(timer);
      setRestored(null);
    };
  }, [pathname, userId]);

  if (!restored) return null;

  const discard = () => {
    const store = loadDrafts(userId);
    delete store[restored.key];
    saveDrafts(userId, store);
    if (restored.form.isConnected) restored.form.reset();
    setRestored(null);
  };

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6"
    >
      <div className="bg-card text-card-foreground pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border py-1 pr-1 pl-4 text-sm shadow-lg">
        <History className="size-4 shrink-0" aria-hidden />
        <span className="py-2">Hemos recuperado el texto que escribiste en este formulario.</span>
        <Button type="button" variant="ghost" size="sm" onClick={discard}>
          Descartar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Cerrar aviso"
          onClick={() => setRestored(null)}
        >
          <X aria-hidden />
        </Button>
      </div>
    </div>
  );
}
