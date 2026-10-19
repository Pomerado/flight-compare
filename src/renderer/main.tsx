import "@fontsource-variable/inter";
import "pomerado-app-kit/styles.css";
import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PomeradoProvider } from "pomerado-app-kit/renderer";
import { COPY } from "@shared/copy";
import { App } from "./App";

document.title = COPY.appName;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PomeradoProvider>
      <App />
    </PomeradoProvider>
  </StrictMode>,
);
