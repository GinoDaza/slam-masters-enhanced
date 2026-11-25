/** The first screen: the mode, and how to play it. */
import { PLAYABLE_RULES, type Ruleset } from '@ssm/rules';
import { MODE_TEXT } from './modes.ts';

interface Props {
  rules: Ruleset;
  setRules: (id: string) => void;
  onLocal: () => void;
  onOnline: () => void;
  onSettings: () => void;
}

export function Home({ rules, setRules, onLocal, onOnline, onSettings }: Props) {
  return (
    <section className="home">
      <h1 className="logo">
        Slam Masters <span>Enhanced</span>
      </h1>
      <div className="ropes" aria-hidden="true"><i /><i /><i /></div>
      <div className="cards" role="group" aria-label="Mode">
        {PLAYABLE_RULES.map((r) => {
          const text = MODE_TEXT[r.id];
          const on = r.id === rules.id;
          return (
            <button key={r.id} className={`card ${on ? 'on' : ''}`} aria-pressed={on} data-first={on || undefined} onClick={() => setRules(r.id)}>
              <strong>{r.label}</strong>
              <em>{text?.tagline}</em>
              {text?.points.map((p) => <span key={p}>{p}</span>)}
            </button>
          );
        })}
      </div>
      <div className="actions">
        <button className="primary" onClick={onLocal}>Play local</button>
        <button className="primary" onClick={onOnline}>Play online</button>
        <button onClick={onSettings}>Settings</button>
      </div>
      <p className="help">Fan project, not affiliated with Capcom.</p>
    </section>
  );
}
