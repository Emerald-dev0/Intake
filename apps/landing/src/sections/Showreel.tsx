import { useState } from 'react';
import { SectionHead } from '../components/SectionHead';
import { Reel } from '../reel/Reel';
import { galleryScenes, edits } from '../reel/scenes';
import { PROVIDERS } from '../lib/providers';
import { useIsMobile } from '../lib/useIsMobile';

export function Showreel() {
  const mobile = useIsMobile();
  const [i, setI] = useState(0);
  const scene = galleryScenes[i];
  if (mobile) return null;
  return (
    <section className="section showreel" id="reels">
      <div className="wrap">
        <SectionHead
          n="03"
          kicker="Watch it work"
          title={
            <>
              Three messages.
              <br />
              Three <em>real</em> forms.
            </>
          }
          lede="Google Forms or Microsoft Forms, sign-ups or feedback, it goes the same way. Pause any of these, scrub through, or skip to the good part."
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
  const mobile = useIsMobile();
  if (mobile) return null;
  return (
    <section className="section edits" id="edits">
      <div className="wrap">
        <div className="edits-head">
          <SectionHead
            n="06"
            kicker="Editing"
            title={
              <>
                Need a change? <em>Just ask.</em>
              </>
            }
            lede="Forms change. Someone always wants one more question. Tell Intake what to change and it updates the real form in your account. No hunting through menus."
          />
          <div className="edits-cmds">
            {['“Make email optional.”', '“Move age before email.”', '“Add an ‘Other’ option.”', '“If they select Other, ask them to explain.”', '“Add a phone number field.”'].map((c) => (
              <span key={c} className="edits-cmd">
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="wrap-wide">
        <Reel scene={edits} />
      </div>
    </section>
  );
}
