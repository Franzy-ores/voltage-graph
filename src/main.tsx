import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

alert('🎯 React app starting');
createRoot(document.getElementById("root")!).render(<App />);
