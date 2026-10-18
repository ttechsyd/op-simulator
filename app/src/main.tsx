import { createRoot } from "react-dom/client";
import App from "./App";
import { armPush } from "./online/push";
import "./app.css";

armPush();

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
