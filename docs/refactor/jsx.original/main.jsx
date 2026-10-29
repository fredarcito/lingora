import "./styles.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import FloatingCaptions from "./FloatingCaptions";
import LangOffer from "./LangOffer";
import Welcome, { WelcomeBoundary, needsWelcome } from "./Welcome";
import { I18nProvider } from "./i18n";

// La ventana de subtítulos flotantes carga esta misma página; Rust marca cuál es.
const floating = /** @type {any} */ (window).__LINGORA_VIEW === "captions";
if (floating) document.documentElement.classList.add("view-captions");

/** La bienvenida la primera vez; si algo falla al comprobarlo, directo a la app. */
function Main() {
  const [welcome, setWelcome] = useState(/** @type {boolean | null} */ (null));
  useEffect(() => {
    needsWelcome()
      .then(setWelcome)
      .catch(() => setWelcome(false));
  }, []);
  if (welcome === null) return null;
  if (!welcome)
    return (
      <>
        <App />
        <LangOffer />
      </>
    );
  return (
    <WelcomeBoundary onDone={() => setWelcome(false)}>
      <Welcome onDone={() => setWelcome(false)} />
    </WelcomeBoundary>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <I18nProvider>{floating ? <FloatingCaptions /> : <Main />}</I18nProvider>
  </StrictMode>,
);
