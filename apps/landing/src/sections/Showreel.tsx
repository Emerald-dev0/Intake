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
    <section className="section showreel" id="reels">
      <div className="wrap">
        <SectionHead
          n="03"
          kicker="Watch it work"
          title={
            <>
              Three requests.
              <br />
              Three <em>form concepts.</em>
            </>
          }
          lede="Scripted concept demos, not real inference or provider calls; some show future capabilities. The authenticated workspace supports Google creation after review and confirmation. Pause, scrub through or skip ahead."
        />
        <div className="sr-tabs" role="tablist">
          {galleryScenes.map((s, k) => (
            <button key={s.id} role="tab" aria-selected={k === i} className={`sr-tab ${k === i ? 'is-on' : ''}`} onClick={() => setI(k)}>
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
      <div className="wrap-wide">
        <Reel key={scene.id} scene={scene} loop={false} onEnd={() => setI((v) => (v + 1) % galleryScenes.length)} />
      </div>
    </section>
  );
}

export function Edits() {
  return (
    <section className="section edits" id="edits">
      <div className="wrap">
        <div className="edits-head">
          <SectionHead
            n="06"
            kicker="Editing"
            title={
              <>
                What can I ask <em>Intake to do?</em>
              </>
            }
            lede="Creation is only the start. Intake is designed to let you change the real form in your provider account with another message, instead of hunting through menus. Editing is not live yet."
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
