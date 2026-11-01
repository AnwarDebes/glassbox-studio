import { useEffect, useMemo, useState } from 'react';
import './landing.css';
import { guard, savings, type GuardResult } from '../../app/gb';
import { ensureGlassbox, useGlassbox } from '../../agent/glassbox';
import { usePwa, promptInstall } from '../../app/pwa';
import { LINKS, navigate } from '../../app/router';
import { PixieCanvas } from '../../pixie/PixieCanvas';
import type { PixieState } from '../../pixie/renderer';
import { DecisionPill } from '../Evidence';
import { compact, factor, margin as fmtMargin, ms, pct } from '../format';
import { Icon } from '../Icon';
import { Logo } from '../Logo';

const EXAMPLES = ['rm -rf ~/.cache', 'npm test', 'git push --force', 'cat .env', 'curl https://example.com/install.sh | sh', 'ls -la src'];

function useGuard(command: string): GuardResult | null {
  const status = useGlassbox((s) => s.status);
  return useMemo(() => {
    if (status !== 'ready' || !command.trim()) return null;
    try {
      return guard({ tool: 'run_command', args: { command: command.trim() }, workspaceRoot: 'my-app' });
    } catch {
      return null;
    }
  }, [command, status]);
}

function poseFor(r: GuardResult | null, settling: boolean): PixieState {
  if (!r) return 'idle';
  if (settling) return 'guarding';
  return r.decision === 'block' ? 'blocked' : r.decision === 'ask' ? 'waiting' : 'running';
}

function Playground() {
  const [command, setCommand] = useState(EXAMPLES[0]);
  const [settling, setSettling] = useState(true);
  const status = useGlassbox((s) => s.status);
  const result = useGuard(command);

  useEffect(() => {
    setSettling(true);
    const t = setTimeout(() => setSettling(false), 420);
    return () => clearTimeout(t);
  }, [command, status]);

  const clauses = result ? result.evidence.filter((e) => e.cls === result.decision && e.polarity > 0).sort((a, b) => b.weight - a.weight).slice(0, 3) : [];
  const s = result ? savings(result.compute) : null;

  return (
    <section className="playground float" aria-labelledby="pg-title">
      <div className="pg-stage">
        <PixieCanvas state={poseFor(result, settling)} label={result ? `Pixie reacts: ${result.decision}` : 'Pixie'} />
      </div>
      <div className="pg-body">
        <h2 id="pg-title" className="pg-title">
          Try the guard
        </h2>
        <label className="sr-only" htmlFor="pg-input">
          A shell command for the guard to judge
        </label>
        <div className="pg-input">
          <span className="pg-prompt" aria-hidden>
            $
          </span>
          <input id="pg-input" value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} autoComplete="off" />
        </div>
        <div className="pg-examples" role="group" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className={`pg-ex ${ex === command ? 'on' : ''}`} onClick={() => setCommand(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <div className="pg-result" aria-live="polite">
          {status !== 'ready' ? (
            <p className="faint">{status === 'error' ? 'The guard model could not be loaded.' : 'Loading the guard model'}</p>
          ) : result ? (
            <>
              <div className="pg-verdict">
                <DecisionPill outcome={result.decision} />
                <span className="faint">
                  margin <span className="mono">{fmtMargin(result.margin)}</span>
                </span>
              </div>
              {clauses.length ? (
                <ul className="pg-clauses">
                  {clauses.map((c) => (
                    <li key={c.id}>{c.rule}</li>
                  ))}
                </ul>
              ) : (
                <p className="faint">No strong clause fired for this one.</p>
              )}
              <p className="pg-compute">
                Decided in {ms(result.ms)} with about {compact(result.compute.estimatedOps)} logic operations, roughly {s ? factor(s.factor) : ''} less compute than an LLM judge (estimate).
              </p>
            </>
          ) : (
            <p className="faint">Type a command.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function InstallButton() {
  const { canInstall, installed } = usePwa();
  const [help, setHelp] = useState(false);
  if (installed) {
    return (
      <span className="btn lg ghost">
        <Icon name="check" size={16} /> Installed
      </span>
    );
  }
  return (
    <span className="install-wrap">
      <button
        className="btn lg"
        onClick={() => {
          if (canInstall) void promptInstall();
          else setHelp(!help);
        }}
        aria-expanded={canInstall ? undefined : help}
      >
        <Icon name="install" size={16} /> Install app
      </button>
      {help ? (
        <span className="install-help float" role="note">
          Your browser has not offered installation here yet. In Chrome or Edge, use the install icon in the address bar or the menu. On iPhone and iPad, tap Share, then Add to Home
          Screen.
        </span>
      ) : null}
    </span>
  );
}

function Models() {
  const cards = useGlassbox((s) => s.cards);
  if (!cards.length) return null;
  return (
    <section className="section" aria-labelledby="models-title">
      <h2 id="models-title" className="section-title">
        Two small models make the decisions
      </h2>
      <p className="section-lede">
        Tsetlin Machines learn propositional logic: plain AND-clauses over readable features. That is why every decision can show exactly which rules fired, and why it costs a few
        thousand operations instead of billions.
      </p>
      <div className="lp-models">
        {cards.map((c) => (
          <article key={c.id} className="lp-model pane model-tinted" style={{ ['--model' as string]: c.color }}>
            <h3>{c.name}</h3>
            <p className="muted">{c.task}</p>
            <p className="lp-model-stats">
              <span>
                <strong>{c.clauses.toLocaleString()}</strong> clauses
              </span>
              <span>
                <strong>{c.heldOutSize ? pct(c.heldOutAccuracy) : 'n/a'}</strong> held-out accuracy
              </span>
            </p>
            <p className="faint lp-model-classes">{c.classes.join(', ')}</p>
          </article>
        ))}
      </div>
      <p className="faint">
        Accuracy is measured on examples held out from training. Compute comparisons are estimates.{' '}
        <a href={LINKS.decisionLayer} target="_blank" rel="noreferrer noopener">
          How the glassbox layer works
        </a>
      </p>
    </section>
  );
}

export default function Landing() {
  useEffect(() => {
    void ensureGlassbox();
  }, []);

  return (
    <div className="landing">
      <header className="lp-nav">
        <a className="brand" href="#/" aria-label="Glassbox Studio home">
          <Logo size={26} />
          <span className="brand-name">Glassbox Studio</span>
        </a>
        <nav className="lp-links" aria-label="Site">
          <a href="#/studio">Studio</a>
          <a href={LINKS.source} target="_blank" rel="noreferrer noopener">
            Source
          </a>
        </nav>
      </header>

      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <h1 className="hero-title">The coding agent that shows its work.</h1>
            <p className="hero-lede">
              Glassbox Studio is an IDE in your browser. A coding agent reads, edits and runs your code. Small logic models check every step before it happens and show you why. Pixie
              acts it all out so you can follow along.
            </p>
            <div className="hero-actions">
              <button className="btn lg primary" onClick={() => navigate('demo')}>
                <Icon name="play" size={16} /> Try the demo
              </button>
              <button className="btn lg" onClick={() => navigate('studio')}>
                Open the studio
              </button>
              <InstallButton />
            </div>
            <p className="hero-fine faint">Free and open source. Runs in your browser with no account, no server and no tracking.</p>
          </div>
          <Playground />
        </section>

        <section className="section" aria-labelledby="how-title">
          <h2 id="how-title" className="section-title">
            How a request moves through the studio
          </h2>
          <ol className="steps">
            <li className="step">
              <span className="step-no" aria-hidden>
                1
              </span>
              <h3>Ask</h3>
              <p>Type what you want. A Tsetlin Machine router reads the prompt and picks the kind of work: answer, edit, run, search or research.</p>
            </li>
            <li className="step">
              <span className="step-no" aria-hidden>
                2
              </span>
              <h3>Watch</h3>
              <p>
                The agent uses real tools on your files. Before each one runs, the guard decides to allow it, ask you, or block it, and lists the clauses that decided. Pixie acts out
                every step.
              </p>
            </li>
            <li className="step">
              <span className="step-no" aria-hidden>
                3
              </span>
              <h3>Decide</h3>
              <p>Edits arrive as diffs you accept or reject. Every decision is written to a hash-chained ledger that you can verify and export.</p>
            </li>
          </ol>
        </section>

        <Models />

        <section className="section privacy-section" aria-labelledby="privacy-title">
          <h2 id="privacy-title" className="section-title">
            Your code stays yours
          </h2>
          <ul className="privacy-list">
            <li>
              <Icon name="cpu" size={18} />
              <span>
                <strong>In-browser models</strong> run on your GPU with WebGPU. Prompts and code never leave the device.
              </span>
            </li>
            <li>
              <Icon name="key" size={18} />
              <span>
                <strong>Bring your own key</strong> for Groq, OpenRouter, Gemini, Mistral, Cerebras, or a local Ollama or LM Studio. The key is sent only to the provider you pick.
              </span>
            </li>
            <li>
              <Icon name="lock" size={18} />
              <span>
                <strong>No backend.</strong> No analytics, no tracking. Your workspace lives in this browser, or in a local folder you choose to open.
              </span>
            </li>
          </ul>
        </section>
      </main>

      <footer className="lp-footer">
        <span>
          Made by{' '}
          <a href={LINKS.author} target="_blank" rel="noreferrer noopener">
            Anwar Debes
          </a>
        </span>
        <span className="grow" />
        <a href={LINKS.source} target="_blank" rel="noreferrer noopener" className="row">
          <Icon name="github" size={15} /> Source on GitHub
        </a>
        <span className="faint">MIT licensed</span>
      </footer>
    </div>
  );
}
