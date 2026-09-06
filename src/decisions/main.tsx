import React from "react";
import ReactDOM from "react-dom/client";
import { DecisionsPage } from "./DecisionsPage";
import "../../decisions/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DecisionsPage />
  </React.StrictMode>
);
