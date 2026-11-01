import { pixie } from '../pixie/director';
import { session, uid, useSession, type NoticeItem } from '../state/session';
import { useSettings } from '../state/settings';
import { workspace } from '../workspace/store';
import { ensureGlassbox } from './glassbox';
import { resetLedger, verifyLedger } from './ledger';
import { DEMO_PROMPT } from './providers/demo';
import { getDemoProvider, isRunning, runTurn, stop } from './runtime';

export { DEMO_PROMPT };

/**
 * Replay the scripted session on a fresh copy of the sample project. The
 * agent's words are scripted; routing, guard decisions, repairs, the test runs
 * and the ledger are all computed live.
 */
export async function startDemo() {
  if (isRunning()) {
    stop();
    await new Promise((r) => setTimeout(r, 60));
  }
  workspace.resetToSample();
  session.clear();
  resetLedger();
  pixie.reset();
  useSettings.setState({ guard: true, showWork: true, askEdits: true, research: false, model: { kind: 'demo' } });
  session.setDemo({ active: true, finished: false });
  await ensureGlassbox();
  // The route is computed and shown live, but the scripted session stays a tool loop.
  const ctx = await runTurn(DEMO_PROMPT, { provider: getDemoProvider(), autoResearch: false });
  if (!ctx || !useSession.getState().demo.active) return;
  pixie.show('guarding', 'Verifying the ledger');
  const v = await verifyLedger();
  session.add<NoticeItem>({
    kind: 'notice',
    id: uid('n'),
    tone: v.ok ? 'success' : 'error',
    text: v.ok
      ? `Ledger verified: ${v.count} entries, each one hashed and linked to the one before it.`
      : `Ledger check failed at entry ${v.brokenAt}.`,
  });
  if (v.ok) pixie.show('celebrating', `Ledger verified: ${v.count} entries`);
  session.setDemo({ active: true, finished: true });
}
