import { useEffect, useMemo, useRef, useState } from 'react';
import { guard as runGuard, route as runRoute, savings, type ModelCard } from '../../app/gb';
import { closePicker, useUi, type PickerTab } from '../../state/ui';
import { setSetting, useSettings, type ProviderConfig } from '../../state/settings';
import { getKey, isRemembered, setKey, forgetKey } from '../../state/keys';
import { ensureGlassbox, kib, useGlassbox } from '../../agent/glassbox';
import { checkWebGpu, LOCAL_MODELS, type GpuReport, type LocalModel } from '../../agent/providers/webllm-models';
import { isLoaded, isModelCached, loadLocalModel } from '../../agent/providers/webllm';
import { PRESETS, PRESET_BY_ID, hostOf, type ProviderPreset } from '../../agent/providers/presets';
import { fetchModels } from '../../agent/providers/openai';
import { LINKS } from '../../app/router';
import { compact, pct } from '../format';
import { Icon } from '../Icon';

const TABS: Array<{ id: PickerTab; label: string }> = [
  { id: 'browser', label: 'In your browser' },
  { id: 'key', label: 'Your API key' },
  { id: 'glassbox', label: 'Glassbox models' },
];

function memory(mb: number): string {
  return mb >= 1000 ? `about ${(mb / 1000).toFixed(1)} GB` : `about ${Math.round(mb)} MB`;
}

// ---------------------------------------------------------------------------

function BrowserTab() {
  const model = useSettings((s) => s.model);
  const [gpu, setGpu] = useState<GpuReport | null>(null);
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState<{ id: string; progress: number; text: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void checkWebGpu().then(setGpu);
  }, []);

  const idFor = (m: LocalModel) => (gpu?.f16 ? m.idF16 : m.idF32);

  useEffect(() => {
    if (!gpu?.supported) return;
    void Promise.all(LOCAL_MODELS.map(async (m) => [idFor(m), await isModelCached(idFor(m))] as const)).then((pairs) => setCached(Object.fromEntries(pairs)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpu]);

  const use = async (m: LocalModel) => {
    const id = idFor(m);
    setError('');
    setLoading({ id, progress: 0, text: 'Starting' });
    try {
      await loadLocalModel(id, (p) => setLoading({ id, progress: p.progress, text: p.text }));
      setSetting('model', { kind: 'webllm', modelId: id });
      setCached((c) => ({ ...c, [id]: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="picker-pane">
      <div className="choice-row demo-choice">
        <div className="grow">
          <div className="choice-title">Demo replay</div>
          <div className="faint">A scripted session on the sample project. The words are scripted; every decision is computed live. Nothing to download.</div>
        </div>
        {model.kind === 'demo' ? (
          <span className="pill glass">In use</span>
        ) : (
          <button className="btn sm" onClick={() => setSetting('model', { kind: 'demo' })}>
            Use the demo
          </button>
        )}
      </div>

      <div className={`gpu-check ${gpu ? (gpu.supported ? 'ok' : 'no') : 'pending'}`} role="status">
        <Icon name={gpu?.supported ? 'check' : gpu ? 'alert' : 'cpu'} size={15} />
        {!gpu
          ? 'Checking for WebGPU'
          : gpu.supported
            ? `WebGPU is available${gpu.adapter ? ` (${gpu.adapter})` : ''}. ${gpu.f16 ? 'Using 16-bit models.' : 'This GPU lacks 16-bit shaders, so 32-bit builds are used.'}`
            : gpu.reason}
      </div>

      <p className="picker-note">
        These models run on your GPU. The weights download once from Hugging Face and stay cached in this browser. Your prompts and code never leave your device.
      </p>

      <div className="model-grid">
        {LOCAL_MODELS.map((m) => {
          const id = idFor(m);
          const active = model.kind === 'webllm' && model.modelId === id && isLoaded(id);
          const isLoading = loading?.id === id;
          return (
            <article key={m.key} className={`model-card ${active ? 'active' : ''}`}>
              <header className="row">
                <span className="model-name grow">{m.name}</span>
                {m.recommended ? <span className="pill glass">Recommended</span> : null}
              </header>
              <p className="faint model-note">{m.note}</p>
              <dl className="model-facts">
                <div>
                  <dt>Download</dt>
                  <dd>about {m.downloadGB} GB{cached[id] ? ', cached' : ''}</dd>
                </div>
                <div>
                  <dt>GPU memory</dt>
                  <dd>{memory(gpu?.f16 ? m.vramMB.f16 : m.vramMB.f32)}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{m.paramsBillions}B parameters</dd>
                </div>
                <div>
                  <dt>Context</dt>
                  <dd>{m.contextTokens.toLocaleString()} tokens</dd>
                </div>
              </dl>
              {isLoading ? (
                <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((loading?.progress ?? 0) * 100)} aria-label={`Loading ${m.name}`}>
                  <span style={{ width: `${Math.max(3, (loading?.progress ?? 0) * 100)}%` }} />
                  <p className="faint progress-text truncate">{loading?.text}</p>
                </div>
              ) : active ? (
                <span className="pill allow">Loaded and in use</span>
              ) : (
                <button className="btn sm" disabled={!gpu?.supported || !!loading} onClick={() => void use(m)}>
                  {cached[id] ? 'Load and use' : `Download ${m.downloadGB} GB and use`}
                </button>
              )}
            </article>
          );
        })}
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function KeyTab() {
  const model = useSettings((s) => s.model);
  const providers = useSettings((s) => s.providers);
  const [pid, setPid] = useState(model.kind === 'remote' ? model.providerId : 'groq');
  const preset = PRESET_BY_ID[pid] as ProviderPreset;
  const saved: ProviderConfig = providers[pid] ?? { baseUrl: preset.baseUrl, model: preset.models[0] ?? '', nativeTools: preset.nativeTools };
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl);
  const [modelId, setModelId] = useState(saved.model);
  const [native, setNative] = useState(saved.nativeTools);
  const [key, setKeyText] = useState(getKey(pid));
  const [remember, setRemember] = useState(isRemembered(pid));
  const [show, setShow] = useState(false);
  const [live, setLive] = useState<string[]>([]);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error' | 'busy'; text: string } | null>(null);

  useEffect(() => {
    const p = PRESET_BY_ID[pid];
    const s = useSettings.getState().providers[pid] ?? { baseUrl: p.baseUrl, model: p.models[0] ?? '', nativeTools: p.nativeTools };
    setBaseUrl(s.baseUrl);
    setModelId(s.model);
    setNative(s.nativeTools);
    setKeyText(getKey(pid));
    setRemember(isRemembered(pid));
    setLive([]);
    setStatus(null);
  }, [pid]);

  const options = useMemo(() => {
    const all = [...new Set([...preset.models, ...live])];
    return pid === 'openrouter' && live.length ? all.filter((m) => m.endsWith(':free')) : all;
  }, [preset, live, pid]);

  const persist = () => {
    setSetting('providers', { ...useSettings.getState().providers, [pid]: { baseUrl: baseUrl.trim(), model: modelId.trim(), nativeTools: native } });
    setKey(pid, key, remember);
  };

  const fetchList = async () => {
    setStatus({ tone: 'busy', text: `Asking ${hostOf(baseUrl)} for its models` });
    try {
      const ids = await fetchModels(preset, baseUrl.trim(), key.trim());
      setLive(ids);
      setStatus({ tone: 'ok', text: `${ids.length} models available${pid === 'openrouter' ? '; showing the free ones' : ''}.` });
    } catch (err) {
      setStatus({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const use = () => {
    if (!baseUrl.trim()) return setStatus({ tone: 'error', text: 'Add a base URL first.' });
    if (!modelId.trim()) return setStatus({ tone: 'error', text: 'Choose a model id.' });
    if (preset.needsKey && !key.trim()) return setStatus({ tone: 'error', text: `Paste your ${preset.name} key first.` });
    persist();
    setSetting('model', { kind: 'remote', providerId: pid });
    setStatus({ tone: 'ok', text: `Using ${modelId} on ${preset.name}.` });
  };

  const host = hostOf(baseUrl);
  return (
    <div className="picker-pane key-pane">
      <nav className="provider-list" aria-label="Providers">
        {PRESETS.map((p) => (
          <button key={p.id} className={`provider ${p.id === pid ? 'active' : ''}`} aria-current={p.id === pid} onClick={() => setPid(p.id)}>
            <span className="provider-name">
              {p.name}
              {model.kind === 'remote' && model.providerId === p.id ? <span className="pill glass">In use</span> : null}
            </span>
            <span className="faint provider-free">{p.free}</span>
          </button>
        ))}
      </nav>
      <form
        className="provider-form"
        onSubmit={(e) => {
          e.preventDefault();
          use();
        }}
      >
        <label className="field">
          <span>Base URL</span>
          <input className="input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://host/v1" spellCheck={false} autoComplete="off" />
        </label>
        <div className="field">
          <label htmlFor="pk-model">Model</label>
          <div className="row">
            <input id="pk-model" className="input mono grow" list={`models-${pid}`} value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="model id" spellCheck={false} autoComplete="off" />
            <button type="button" className="btn sm" onClick={() => void fetchList()} disabled={!baseUrl.trim()}>
              Fetch list
            </button>
          </div>
          <datalist id={`models-${pid}`}>
            {options.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="pk-key">API key{preset.needsKey ? '' : ' (optional)'}</label>
          <div className="row">
            <input
              id="pk-key"
              className="input mono grow"
              type={show ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKeyText(e.target.value)}
              placeholder={preset.needsKey ? 'Paste your key' : 'Not needed for most local servers'}
              spellCheck={false}
              autoComplete="off"
            />
            <button type="button" className="icon-btn" aria-label={show ? 'Hide key' : 'Show key'} aria-pressed={show} onClick={() => setShow(!show)}>
              <Icon name="eye" />
            </button>
          </div>
        </div>
        <div className="row wrap">
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember the key on this device
          </label>
          <label className="check">
            <input type="checkbox" checked={native} onChange={(e) => setNative(e.target.checked)} /> Native tool calling
          </label>
        </div>
        <p className="privacy">
          <Icon name="lock" size={14} />
          <span>
            Your key stays in this browser ({remember ? 'saved on this device' : 'only until you close the tab'}) and is sent only to <strong>{host}</strong>. There is no Glassbox server.
          </span>
        </p>
        {preset.hint ? <p className="faint">{preset.hint}</p> : null}
        {status ? (
          <p className={`form-status ${status.tone}`} role={status.tone === 'error' ? 'alert' : 'status'}>
            {status.text}
          </p>
        ) : null}
        <div className="row form-actions">
          {preset.keyUrl ? (
            <a className="btn ghost sm" href={preset.keyUrl} target="_blank" rel="noreferrer noopener">
              Get a key <Icon name="external" size={13} />
            </a>
          ) : null}
          {key && isRemembered(pid) ? (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                forgetKey(pid);
                setKeyText('');
                setRemember(false);
                setStatus({ tone: 'ok', text: 'Key removed from this device.' });
              }}
            >
              Forget key
            </button>
          ) : null}
          <span className="grow" />
          <button type="submit" className="btn primary">
            Use this model
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

function sampleCompute(card: ModelCard) {
  try {
    const r = card.classes.includes('block')
      ? runGuard({ tool: 'run_command', args: { command: 'npm test' } })
      : runRoute('Fix the failing test in src/config.js and run the tests');
    if (r.modelId !== card.id) return null;
    return { ops: r.compute.estimatedOps, s: savings(r.compute) };
  } catch {
    return null;
  }
}

function GlassboxTab() {
  const { status, cards, stats, error } = useGlassbox();
  const guardOn = useSettings((s) => s.guard);
  useEffect(() => {
    void ensureGlassbox();
  }, []);

  return (
    <div className="picker-pane">
      <p className="picker-note">
        Two small Tsetlin Machine models make the agent's decisions. They are sets of readable logic clauses, not neural networks: every decision lists the clauses that fired. They run on
        your CPU in about a millisecond or less.{' '}
        <a href={LINKS.decisionLayer} target="_blank" rel="noreferrer noopener">
          How the glassbox layer works
        </a>
      </p>
      <div className="choice-row">
        <div className="grow">
          <div className="choice-title">Glassbox guard</div>
          <div className="faint">Check every tool call before it runs: allow, ask you, or block with a safer alternative.</div>
        </div>
        <button type="button" role="switch" aria-checked={guardOn} className="switch" onClick={() => setSetting('guard', !guardOn)}>
          <span className="knob" aria-hidden />
          {guardOn ? 'On' : 'Off'}
        </button>
      </div>
      {status === 'loading' || status === 'idle' ? <p className="faint">Loading the models</p> : null}
      {status === 'error' ? (
        <p className="form-error" role="alert">
          The glassbox models could not be loaded: {error}
        </p>
      ) : null}
      {cards.length ? (
        <p className="faint gb-caveat">
          Prototype figures on synthetic data: accuracy on examples held out from training, and on a small hand-written challenge set. The models have not been evaluated on real agent
          sessions.
        </p>
      ) : null}
      <div className="gb-grid">
        {cards.map((c) => {
          const est = sampleCompute(c);
          const st = stats[c.id];
          return (
            <article key={c.id} className="gb-card model-tinted" style={{ ['--model' as string]: c.color }}>
              <header>
                <span className="gb-swatch" aria-hidden />
                <span className="model-name">{c.name}</span>
              </header>
              <p className="gb-task">{c.task}</p>
              <div className="gb-classes">
                {c.classes.map((k) => (
                  <code key={k} className="lit">
                    {k}
                  </code>
                ))}
              </div>
              <dl className="model-facts">
                <div>
                  <dt>Held-out accuracy</dt>
                  <dd>{c.heldOutSize ? `${pct(c.heldOutAccuracy)} on ${c.heldOutSize.toLocaleString()} examples` : 'not measured yet'}</dd>
                </div>
                <div>
                  <dt>Challenge set</dt>
                  <dd>{st?.challenge ? `${pct(st.challenge.accuracy)} on ${st.challenge.n.toLocaleString()} hand-written examples` : 'not measured'}</dd>
                </div>
                <div>
                  <dt>Clauses</dt>
                  <dd>
                    {c.clauses.toLocaleString()}
                    {st ? ` over ${st.features.toLocaleString()} features` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Model file</dt>
                  <dd>{st ? kib(st.bytes) : 'unknown'}</dd>
                </div>
                <div>
                  <dt>Literals per clause</dt>
                  <dd>{c.avgLiterals.toFixed(1)} on average</dd>
                </div>
                <div>
                  <dt>Trained</dt>
                  <dd>{c.trainedAt ? new Date(c.trainedAt).toLocaleDateString() : 'not yet'}</dd>
                </div>
              </dl>
              {est ? (
                <p className="gb-compute">
                  About {compact(est.ops)} logic operations per decision: {est.s.text}. <span className="faint">Estimate.</span>
                </p>
              ) : null}
              {c.notes ? <p className="faint gb-notes">{c.notes}</p> : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ModelPicker() {
  const tab = useUi((s) => s.picker);
  const ref = useRef<HTMLDialogElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (tab && !d.open) d.showModal();
    if (!tab && d.open) d.close();
  }, [tab]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="picker-title"
      onClose={closePicker}
      onClick={(e) => {
        if (e.target === ref.current) closePicker();
      }}
    >
      {tab ? (
        <div className="sheet-body float picker">
          <header className="picker-head">
            <h2 id="picker-title">Models</h2>
            <div className="seg" role="tablist" aria-label="Model sources" ref={tabsRef}>
              {TABS.map((t, i) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  tabIndex={tab === t.id ? 0 : -1}
                  className={`seg-btn ${tab === t.id ? 'active' : ''} ${t.id === 'glassbox' ? 'gb' : ''}`}
                  onClick={() => useUi.setState({ picker: t.id })}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length];
                    useUi.setState({ picker: next.id });
                    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[TABS.indexOf(next)]?.focus();
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button className="icon-btn" aria-label="Close" onClick={closePicker}>
              <Icon name="x" />
            </button>
          </header>
          <div className="picker-body" role="tabpanel">
            {tab === 'browser' ? <BrowserTab /> : tab === 'key' ? <KeyTab /> : <GlassboxTab />}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
