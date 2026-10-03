import { useState } from 'react';
import { SectionHead } from '../components/SectionHead';
import { Reel } from '../reel/Reel';
import { galleryScenes, edits } from '../reel/scenes';
import { PROVIDERS } from '../lib/providers';
import { ExampleCommands } from '../components/ExampleCommands';

export function Showreel() {
  const [i, setI] = useState(0);
  const scene = galleryScenes[i];
  return (
    <section className="section showreel" id="reels" aria-labelledby="reels-title">
      <div className="wrap">
        <SectionHead
          n="03"
          kicker="Illustrative workflow demos"
          titleId="reels-title"
          title={<>Google Forms, explained with <em>examples.</em></>}
          lede="These timelines are scripted illustrations: they do not call AI or Google, connect an account, create a form, or apply an edit. Actual workspace actions use a reviewed proposal and explicit confirmation. Pause, scrub through, or skip ahead."
        />
        <div className="sr-tabs" role="tablist" aria-label="Illustrative workflow demos">
          {galleryScenes.map((s, k) => (
            <button key={s.id} id={`gallery-tab-${s.id}`} role="tab" aria-controls="gallery-panel" aria-selected={k === i} className={`sr-tab ${k === i ? 'is-on' : ''}`} onClick={() => setI(k)}>
              <span className="sr-n">{String(k + 1).padStart(2, '0')}</span>
              <span className="sr-name">{s.name}</span>
              <span className="sr-pv" style={{ ['--pv' as string]: PROVIDERS[s.provider].color }}>
                <i /> {PROVIDERS[s.provider].name}
              </span>
              <span className="sr-blurb">{s.blurb}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="wrap-wide" id="gallery-panel" role="tabpanel" aria-labelledby={`gallery-tab-${scene.id}`} tabIndex={0}>
        <Reel key={scene.id} scene={scene} loop={false} onEnd={() => setI((v) => (v + 1) % galleryScenes.length)} />
      </div>
    </section>
  );
}

export function Edits() {
  return (
    <section className="section edits" id="edits" aria-labelledby="edits-title">
      <div className="wrap">
        <div className="edits-head">
          <SectionHead
            n="06"
            kicker="Edit existing Google Forms"
            titleId="edits-title"
            title={<>Describe the change. <em>Review it.</em></>}
            lede="Choose a form from your Intake library or provide its Google Forms edit URL. Intake reads the current form and prepares a structured proposal for supported changes. Review it, then confirm to update that same form; Intake does not create a replacement. This timeline is scripted and does not edit a real form."
          />
          <ExampleCommands />
        </div>
      </div>
      <div className="wrap-wide">
        <Reel scene={edits} />
      </div>
    </section>
  );
}
