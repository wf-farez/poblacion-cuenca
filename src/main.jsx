import { createRoot } from "react-dom/client";
import "./movidata.css"; // hoja de estilos de MOVIDATA (la misma de sp03, incluye MapLibre)
import "./styles.css"; // ajustes propios: tabla, ficha y gráfico
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);
