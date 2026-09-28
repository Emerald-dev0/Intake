/**
 * Dev-only page used to record the README demo videos.
 * Open /capture.html?scene=conference and drive it with tools/record-demo.mjs.
 * Not part of the production build (vite only builds index.html).
 */
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import '../src/styles/base.css';
import '../src/styles/reel.css';
import '../src/styles/sections.css';
import { Reel } from '../src/reel/Reel';
import { conference, feedback, football, volunteers, edits, type Scene } from '../src/reel/scenes';
import { buildCreateTimeline, buildEditTimeline } from '../src/reel/scenes';

const SCENES: Record<string, Scene> = { conference, feedback, football, volunteers, edits };
const q = new URLSearchParams(location.search);
const scene = SCENES[q.get('scene') ?? 'conference'] ?? conference;
const tl = scene.kind === 'create' ? buildCreateTimeline(scene) : buildEditTimeline(scene);
(window as unknown as { __reelEnd: number }).__reelEnd = tl.end;

const style = document.createElement('style');
style.textContent = `
  body.capture { margin: 0; background: #0c0c0b; overflow: hidden; }
  body.capture .grain { display: none; }
  body.capture .reel { border-radius: 0; padding: 0; border: 0; box-shadow: none; background: none; }
  body.capture .reel-bar, body.capture .reel-bigplay { display: none !important; }
  body.capture .reel-screen { border-radius: 0; }
`;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(
  <div style={{ width: q.get('w') ? Number(q.get('w')) : 1280 }}>
    <Reel scene={scene} loop={false} />
  </div>,
);
