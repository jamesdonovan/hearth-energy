import React from "react";
import ReactDOM from "react-dom/client";
import { DevFlow } from "./pages/DevFlow";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { StoreProvider } from "./lib/store";
import { Shell } from "./components/Shell";
import { Overview } from "./pages/Overview";
import { Energy } from "./pages/Energy";
import { Cars } from "./pages/Cars";
import { Plan } from "./pages/Plan";
import { Alerts } from "./pages/Alerts";
import { Settings } from "./pages/Settings";
import { Wall } from "./pages/Wall";
import { applyTheme, watchSystemTheme } from "./lib/theme";
import { registerSw } from "./lib/push";
import "./index.css";

applyTheme();
watchSystemTheme();
if (import.meta.env.PROD) registerSw();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/wall" element={<Wall />} />
          <Route element={<Shell />}>
            <Route path="/" element={<Overview />} />
            <Route path="/energy" element={<Energy />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/cars" element={<Cars />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/dev/flow" element={<DevFlow />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  </React.StrictMode>,
);
