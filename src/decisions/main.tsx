import React from "react";
import { themeReady } from "../shared/theme";
import ReactDOM from "react-dom/client";
import { DecisionsPage } from "./DecisionsPage";
import "../../decisions/styles.css";

void themeReady.then(() => ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DecisionsPage />
  </React.StrictMode>
));
